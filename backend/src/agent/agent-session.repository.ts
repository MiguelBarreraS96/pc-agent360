import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { notFound } from "../errors";

import { EMPTY_AGENT_CONTEXT, type AgentContext, type AgentSessionRecord } from "./agent.models";

const AGENT_SESSIONS_COLLECTION = "agentSessions";
export const AGENT_SESSION_TTL_MILLISECONDS = 4 * 60 * 60 * 1_000;

interface AgentSessionDocument {
  readonly context: AgentContext;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly ownerUserId: string;
  readonly updatedAt: Timestamp;
}

/** Persist the conversation between turns so the stateless graph can run on any Cloud Run instance. */
export class AgentSessionRepository {
  public constructor(private readonly firestore: Firestore) {}

  /** Store a new session. The lead's document number is never part of the persisted context. */
  public async create(id: string, ownerUserId: string, context: AgentContext): Promise<void> {
    const now = Timestamp.now();
    const document: AgentSessionDocument = {
      context,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + AGENT_SESSION_TTL_MILLISECONDS),
      ownerUserId,
      updatedAt: now,
    };

    await this.firestore.collection(AGENT_SESSIONS_COLLECTION).doc(id).set(document);
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
}
