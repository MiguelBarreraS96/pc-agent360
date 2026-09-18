import {
  DataStoreServiceClient,
  DocumentServiceClient,
  EngineServiceClient,
  SearchServiceClient,
} from "@google-cloud/discoveryengine";

const clientsByLocation = new Map<string, DiscoveryEngineClients>();

export interface DiscoveryEngineClients {
  readonly dataStoreServiceClient: DataStoreServiceClient;
  readonly documentServiceClient: DocumentServiceClient;
  readonly engineServiceClient: EngineServiceClient;
  readonly searchServiceClient: SearchServiceClient;
}

/** Resolve the required Discovery Engine endpoint for a global or regional resource location. */
export function apiEndpointFor(location: string): string {
  return location === "global" ? "discoveryengine.googleapis.com" : `${location}-discoveryengine.googleapis.com`;
}

/** Return the cached DataStore client for one Discovery Engine location. */
export function getDataStoreClient(location: string): DataStoreServiceClient {
  return getDiscoveryEngineClients(location).dataStoreServiceClient;
}

/** Return the cached Engine client for one Discovery Engine location. */
export function getEngineClient(location: string): EngineServiceClient {
  return getDiscoveryEngineClients(location).engineServiceClient;
}

/** Reuse Discovery Engine clients by location so each location keeps its required API endpoint. */
export function createDiscoveryEngineClients(location: string): DiscoveryEngineClients {
  return getDiscoveryEngineClients(location);
}

function getDiscoveryEngineClients(location: string): DiscoveryEngineClients {
  const existingClients = clientsByLocation.get(location);
  if (existingClients !== undefined) {
    return existingClients;
  }

  const clientOptions = { apiEndpoint: apiEndpointFor(location) };
  const clients: DiscoveryEngineClients = {
    dataStoreServiceClient: new DataStoreServiceClient(clientOptions),
    documentServiceClient: new DocumentServiceClient(clientOptions),
    engineServiceClient: new EngineServiceClient(clientOptions),
    searchServiceClient: new SearchServiceClient(clientOptions),
  };
  clientsByLocation.set(location, clients);
  return clients;
}
