import { GoogleGenAI } from "@google/genai";
import appConfig from "../config.js";
import {
  ProviderImageOutput,
  MediaGenerationProvider,
  ProviderVideoOutput,
} from "./types.js";
import { log } from "../utils/logger.js";
// import { v4 as uuidv4 } from 'uuid'; // Not generating IDs at provider level for images yet

const ai = new GoogleGenAI({ apiKey: appConfig.GOOGLE_API_KEY });

class GoogleProvider implements MediaGenerationProvider {
  async generateImage(args: {
    prompt: string;
    numberOfImages?: number;
  }): Promise<ProviderImageOutput[]> {
    log.info("GoogleProvider: Generating image from text", {
      prompt: args.prompt,
    });
    try {
      const config = {
        // Google API might refer to N as number of candidates, not strictly number of final images.
        // The original code picked the first if multiple were theoretically possible.
        // For now, we align with the expectation of `numberOfImages` if the API supports it directly for output count.
        // Imagen API `generateImages` takes `config.numberOfImages` directly.
        numberOfImages: args.numberOfImages || 1,
      };

      const response = await ai.models.generateImages({
        model: "imagen-3.0-generate-002", // As per original generateVideo.ts
        prompt: args.prompt,
        config: config,
      });

      if (!response.generatedImages || response.generatedImages.length === 0) {
        throw new Error("GoogleProvider: No images generated in the response");
      }

      const imageOutputs: ProviderImageOutput[] = [];
      for (const generatedImage of response.generatedImages) {
        if (!generatedImage.image?.imageBytes) {
          log.warn(
            "GoogleProvider: Generated image missing image bytes from Google API response"
          );
          continue; // Skip if no image data
        }
        imageOutputs.push({
          // Google API doesn't return a persistent ID for the raw generated image here.
          // An ID will be assigned by the orchestrator when saving (e.g., `saveGeneratedImage`)
          imageData: generatedImage.image.imageBytes,
          // The API response for Imagen might specify mimeType, or we assume based on typical output.
          // Original code assumed 'image/png' when saving.
          mimeType: generatedImage.image.mimeType || "image/png",
          prompt: args.prompt, // Or `generatedImage.prompt` if available and potentially revised by Google
        });
      }
      return imageOutputs;
    } catch (error) {
      log.error("GoogleProvider: Error generating image", error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  // Google Video (e.g., Veo) is handled by VeoProvider.
  // If Google GenAI SDK expands to include Veo directly in future, this could be revisited.
  async generateVideoFromText(args: any): Promise<ProviderVideoOutput[]> {
    log.warn(
      "GoogleProvider: generateVideoFromText is not implemented. Use VeoProvider for Veo videos."
    );
    throw new Error(
      "GoogleProvider: generateVideoFromText is not implemented. Use VeoProvider for Veo videos."
    );
  }

  async generateVideoFromImage(args: any): Promise<ProviderVideoOutput[]> {
    log.warn(
      "GoogleProvider: generateVideoFromImage is not implemented. Use VeoProvider for Veo videos."
    );
    throw new Error(
      "GoogleProvider: generateVideoFromImage is not implemented. Use VeoProvider for Veo videos."
    );
  }
}

export const googleProvider = new GoogleProvider();
