import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { EMPTY_AGENT_CONTEXT, type AgentContext } from "./agent.models";
import { AgentSessionRepository, type CreateAgentSessionInput } from "./agent-session.repository";

const SESSION_ID = "3f2b8c1e-6a4d-4e0b-9c1a-2d5e7f8a9b0c";
const OWNER_USER_ID = "user-1";
const DOCUMENTO = "1012345678";
const ASESOR_EMAIL = "asesor@segurosbolivar.com";
const CONTEXT: AgentContext = { ...EMPTY_AGENT_CONTEXT };

const BASE_INPUT: CreateAgentSessionInput = {
  asesorEmail: ASESOR_EMAIL,
  context: CONTEXT,
  documento: DOCUMENTO,
  encontrado: true,
  id: SESSION_ID,
  ownerUserId: OWNER_USER_ID,
};

/** Minimal fake of the Firestore document/collection chain the repository uses. */
function fakeFirestore(data?: Record<string, unknown>) {
  const set = jest.fn().mockResolvedValue(undefined);
  const update = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn().mockResolvedValue({
    data: () => data,
    exists: data !== undefined,
  });
  const doc = jest.fn().mockReturnValue({ get, set, update });
  const collection = jest.fn().mockReturnValue({ doc });

  return { collection, doc, firestore: { collection } as unknown as Firestore, get, set, update };
}

/** Minimal fake of the paginated Firestore query chain used by listConsultations. */
function fakeQueryFirestore(pages: readonly (readonly Record<string, unknown>[])[]) {
  let call = 0;
  const docsOf = (page: readonly Record<string, unknown>[]) =>
    page.map((data) => ({ data: () => data }));

  const query: Record<string, jest.Mock> = {};
  const get = jest.fn().mockImplementation(async () => {
    const page = pages[call] ?? [];
    call += 1;
    const docs = docsOf(page);
    return { docs, empty: docs.length === 0 };
  });
  query.where = jest.fn().mockReturnValue(query);
  query.orderBy = jest.fn().mockReturnValue(query);
  query.select = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  query.startAfter = jest.fn().mockReturnValue(query);
  query.get = get;

  const collection = jest.fn().mockReturnValue(query);
  return { collection, firestore: { collection } as unknown as Firestore, query };
}

describe("AgentSessionRepository.create", () => {
  it("writes documento, encontrado and asesorEmail at the document root, never inside context", async () => {
    const { firestore, set } = fakeFirestore();
    const repository = new AgentSessionRepository(firestore);

    await repository.create(BASE_INPUT);

    expect(set).toHaveBeenCalledTimes(1);
    const written = set.mock.calls[0][0] as Record<string, unknown>;
    expect(written.documento).toBe(DOCUMENTO);
    expect(written.encontrado).toBe(true);
    expect(written.asesorEmail).toBe(ASESOR_EMAIL);
    expect(written.context).toEqual(CONTEXT);
    expect(JSON.stringify(written.context)).not.toContain(DOCUMENTO);
  });

  it("sets expiresAt equal to createdAt when the lead was not found", async () => {
    const { firestore, set } = fakeFirestore();
    const repository = new AgentSessionRepository(firestore);

    await repository.create({ ...BASE_INPUT, encontrado: false });

    const written = set.mock.calls[0][0] as { createdAt: Timestamp; encontrado: boolean; expiresAt: Timestamp };
    expect(written.encontrado).toBe(false);
    expect(written.expiresAt.isEqual(written.createdAt)).toBe(true);
  });

  it("sets expiresAt after createdAt when the lead was found", async () => {
    const { firestore, set } = fakeFirestore();
    const repository = new AgentSessionRepository(firestore);

    await repository.create(BASE_INPUT);

    const written = set.mock.calls[0][0] as { createdAt: Timestamp; expiresAt: Timestamp };
    expect(written.expiresAt.toMillis()).toBeGreaterThan(written.createdAt.toMillis());
  });
});

describe("AgentSessionRepository.saveContext", () => {
  it("updates only context and updatedAt, leaving documento, encontrado and asesorEmail untouched", async () => {
    const { firestore, update } = fakeFirestore();
    const repository = new AgentSessionRepository(firestore);
    const nextContext: AgentContext = { ...EMPTY_AGENT_CONTEXT, selectedProduct: { id: "auto-1", name: "Seguro de Autos" } };

    await repository.saveContext(SESSION_ID, nextContext);

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["context", "updatedAt"]);
    expect(payload.context).toEqual(nextContext);
  });
});

describe("AgentSessionRepository.load", () => {
  it("does not return documento, encontrado or asesorEmail even though they are stored on the document", async () => {
    const now = Timestamp.now();
    const { firestore } = fakeFirestore({
      asesorEmail: ASESOR_EMAIL,
      context: CONTEXT,
      createdAt: now,
      documento: DOCUMENTO,
      encontrado: true,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000),
      ownerUserId: OWNER_USER_ID,
      updatedAt: now,
    });
    const repository = new AgentSessionRepository(firestore);

    const record = await repository.load(SESSION_ID, OWNER_USER_ID);

    expect(record).not.toHaveProperty("documento");
    expect(record).not.toHaveProperty("encontrado");
    expect(record).not.toHaveProperty("asesorEmail");
    expect(Object.keys(record).sort()).toEqual(["context", "createdAt", "expiresAt", "id", "ownerUserId", "updatedAt"]);
  });
});

describe("AgentSessionRepository.listConsultations", () => {
  const FROM = new Date("2026-09-01T05:00:00.000Z");
  const TO = new Date("2026-09-26T05:00:00.000Z");

  it("projects only report fields with select() and paginates with startAfter()", async () => {
    const now = Timestamp.now();
    const { firestore, query } = fakeQueryFirestore([
      [{ asesorEmail: ASESOR_EMAIL, createdAt: now, documento: DOCUMENTO, encontrado: true }],
    ]);
    const repository = new AgentSessionRepository(firestore);

    const records = [];
    for await (const record of repository.listConsultations(FROM, TO, 10)) {
      records.push(record);
    }

    expect(records).toEqual([{ asesorEmail: ASESOR_EMAIL, createdAt: now.toDate(), documento: DOCUMENTO, encontrado: true }]);
    expect(query.select).toHaveBeenCalledWith("documento", "encontrado", "asesorEmail", "createdAt");
    expect(query.orderBy).toHaveBeenCalledWith("createdAt");
  });

  it("requests a second page with startAfter when the first page is full", async () => {
    const now = Timestamp.now();
    const page1 = [
      { asesorEmail: ASESOR_EMAIL, createdAt: now, documento: "1", encontrado: true },
      { asesorEmail: ASESOR_EMAIL, createdAt: now, documento: "2", encontrado: true },
    ];
    const page2 = [{ asesorEmail: ASESOR_EMAIL, createdAt: now, documento: "3", encontrado: true }];
    const { firestore, query } = fakeQueryFirestore([page1, page2]);
    const repository = new AgentSessionRepository(firestore);

    const records = [];
    for await (const record of repository.listConsultations(FROM, TO, 2)) {
      records.push(record);
    }

    expect(records.map((record) => record.documento)).toEqual(["1", "2", "3"]);
    expect(query.startAfter).toHaveBeenCalledTimes(1);
  });

  it("skips documents without documento and defaults missing encontrado/asesorEmail", async () => {
    const now = Timestamp.now();
    const { firestore } = fakeQueryFirestore([
      [
        { asesorEmail: ASESOR_EMAIL, createdAt: now, encontrado: true },
        { createdAt: now, documento: DOCUMENTO },
      ],
    ]);
    const repository = new AgentSessionRepository(firestore);

    const records = [];
    for await (const record of repository.listConsultations(FROM, TO)) {
      records.push(record);
    }

    expect(records).toEqual([{ asesorEmail: "", createdAt: now.toDate(), documento: DOCUMENTO, encontrado: true }]);
  });
});
