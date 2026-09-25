import { Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";

import { notFound } from "../errors";

import { EMPTY_AGENT_CONTEXT, type AgentContext, type AgentSessionRecord } from "./agent.models";

const AGENT_SESSIONS_COLLECTION = "agentSessions";
/** Bounds how long a conversation can be resumed; it never triggers deletion of the underlying document. */
export const AGENT_SESSION_TTL_MILLISECONDS = 4 * 60 * 60 * 1_000;
const DEFAULT_CONSULTATIONS_PAGE_SIZE = 1_000;

interface AgentSessionDocument {
  readonly asesorEmail: string;
  readonly context: AgentContext;
  readonly createdAt: Timestamp;
  readonly documento: string;
  readonly encontrado: boolean;
  readonly expiresAt: Timestamp;
  readonly ownerUserId: string;
  readonly updatedAt: Timestamp;
}

export interface CreateAgentSessionInput {
  readonly asesorEmail: string;
  readonly context: AgentContext;
  readonly documento: string;
  readonly encontrado: boolean;
  readonly id: string;
  readonly ownerUserId: string;
}

/** One consultation as read back for the administrator's report; never includes the full conversation. */
export interface ConsultationRecord {
  readonly asesorEmail: string;
  readonly createdAt: Date;
  readonly documento: string;
  readonly encontrado: boolean;
}

/** Persist the conversation between turns so the stateless graph can run on any Cloud Run instance. */
export class AgentSessionRepository {
  public constructor(private readonly firestore: Firestore) {}

  /**
   * Store a new session. The lead's document number is kept at the document root for traceability, never inside
   * the context sent to the model. When `encontrado` is false the session expires immediately (`expiresAt ===
   * createdAt`), so it is recorded for reporting but can never be resumed as a conversation.
   */
  public async create(input: CreateAgentSessionInput): Promise<void> {
    const now = Timestamp.now();
    const document: AgentSessionDocument = {
      asesorEmail: input.asesorEmail,
      context: input.context,
      createdAt: now,
      documento: input.documento,
      encontrado: input.encontrado,
      expiresAt: input.encontrado ? Timestamp.fromMillis(now.toMillis() + AGENT_SESSION_TTL_MILLISECONDS) : now,
      ownerUserId: input.ownerUserId,
      updatedAt: now,
    };

    await this.firestore.collection(AGENT_SESSIONS_COLLECTION).doc(input.id).set(document);
  }

  /** Load a live session owned by the caller; missing, foreign, and expired sessions are indistinguishable. */
  public async load(id: string, ownerUserId: string): Promise<AgentSessionRecord> {
    const snapshot = await this.firestore.collection(AGENT_SESSIONS_COLLECTION).doc(id).get();
    if (!snapshot.exists) {
      throw notFound();
    }

    const document = snapshot.data() as AgentSessionDocument;
    if (document.ownerUserId !== ownerUserId || document.expiresAt.toMillis() <= Date.now()) {
      throw notFound();
    }

    return {
      context: { ...EMPTY_AGENT_CONTEXT, ...document.context },
      createdAt: document.createdAt.toDate(),
      expiresAt: document.expiresAt.toDate(),
      id,
      ownerUserId,
      updatedAt: document.updatedAt.toDate(),
    };
  }

  public async saveContext(id: string, context: AgentContext): Promise<void> {
    await this.firestore.collection(AGENT_SESSIONS_COLLECTION).doc(id).update({ context, updatedAt: Timestamp.now() });
  }

  /**
   * Stream the consultations whose `createdAt` falls in `[from, to)`, oldest first, projecting only the fields the
   * report needs. Pages with `select()` + `startAfter()` so the full conversation context is never loaded into
   * memory. Documents without `documento` (sessions created before that field existed) are skipped; a missing
   * `encontrado` is treated as `true` and a missing `asesorEmail` as an empty string (see PLAN-REPORTE-CONSULTAS-
   * CLIENTE360.md, 5.3).
   */
  public async *listConsultations(
    from: Date,
    to: Date,
    pageSize = DEFAULT_CONSULTATIONS_PAGE_SIZE,
  ): AsyncGenerator<ConsultationRecord> {
    const fromTimestamp = Timestamp.fromDate(from);
    const toTimestamp = Timestamp.fromDate(to);
    let cursor: QueryDocumentSnapshot | undefined;

    for (;;) {
      let query = this.firestore
        .collection(AGENT_SESSIONS_COLLECTION)
        .where("createdAt", ">=", fromTimestamp)
        .where("createdAt", "<", toTimestamp)
        .orderBy("createdAt")
        .select("documento", "encontrado", "asesorEmail", "createdAt")
        .limit(pageSize);

      if (cursor !== undefined) {
        query = query.startAfter(cursor);
      }

      const snapshot = await query.get();
      if (snapshot.empty) {
        return;
      }

      for (const document of snapshot.docs) {
        const data = document.data();
        const documento = data.documento as string | undefined;
        if (documento === undefined) {
          continue;
        }

        yield {
          asesorEmail: typeof data.asesorEmail === "string" ? data.asesorEmail : "",
          createdAt: (data.createdAt as Timestamp).toDate(),
          documento,
          encontrado: typeof data.encontrado === "boolean" ? data.encontrado : true,
        };
      }

      if (snapshot.docs.length < pageSize) {
        return;
      }

      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
  }
}
