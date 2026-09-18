import { GoogleGenAI } from "@google/genai";

/**
 * Create the Gemini client in Vertex AI mode, authenticated via Cloud Run Application Default
 * Credentials. Never uses the Gemini Developer API key mode.
 */
export function createGeminiClient(projectId: string, location: string): GoogleGenAI {
  return new GoogleGenAI({ location, project: projectId, vertexai: true });
}
