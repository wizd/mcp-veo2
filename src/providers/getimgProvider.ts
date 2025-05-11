import appConfig from "../config.js";
import { ProviderImageOutput, MediaGenerationProvider } from "./types.js";
import { log } from "../utils/logger.js";

const GETIMG_API_URL = "https://api.getimg.ai/v1/flux-schnell/text-to-image";
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

class GetimgProvider implements MediaGenerationProvider {
  async generateImage(args: {
    prompt: string;
    numberOfImages?: number; // Currently generates 1, but param is kept for interface consistency
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    outputFormat?: "jpeg" | "png";
  }): Promise<ProviderImageOutput[]> {
    log.info(
      `GetimgProvider: Generating image. Prompt: "${args.prompt}", Width: ${
        args.width
      }, Height: ${args.height}, Steps: ${args.steps}, Seed: ${
        args.seed
      }, Format: ${args.outputFormat || "jpeg"}`
    );

    if (!appConfig.GETIMG_API_KEY) {
      throw new Error("GetimgProvider: GETIMG_API_KEY is not configured.");
    }

    const requestBody: any = {
      prompt: args.prompt,
      response_format: "b64", // Explicitly request base64 response
      output_format: args.outputFormat || "jpeg", // Default to jpeg as per API docs
      steps: args.steps || 4, // API default is 4
    };

    if (args.width) requestBody.width = args.width;
    if (args.height) requestBody.height = args.height;
    if (args.seed) requestBody.seed = args.seed;
    // Note: The API docs for FLUX.1 [schnell] don't explicitly list a parameter for number of images.
    // We will continue to generate one image per call.
    if (args.numberOfImages && args.numberOfImages > 1) {
      log.warn(
        `GetimgProvider: Requested ${args.numberOfImages} images, but this provider currently only generates one per call.`
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      log.warn(
        `GetimgProvider: Request for prompt "${
          args.prompt
        }" is timing out after ${DEFAULT_TIMEOUT_MS / 1000}s.`
      );
      controller.abort();
    }, DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(GETIMG_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appConfig.GETIMG_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json", // Important for some APIs to ensure JSON response
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal, // Added abort signal
      });

      clearTimeout(timeoutId); // Clear timeout if fetch completes or errors before timeout

      if (!response.ok) {
        const errorBody = await response.text();
        log.error("GetimgProvider: API request failed", {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          requestBody: requestBody, // Log what was sent
        });
        throw new Error(
          `GetimgProvider: API request failed with status ${response.status}: ${errorBody}`
        );
      }

      const responseData = await response.json();

      // Based on new info: response_format: 'b64'.
      // The API doc example showed 'url' field for url response.
      // For b64, it might be 'image_b64', 'b64_json', 'image', or 'data'.
      // The documentation does not explicitly state the field name for the base64 string.
      // We'll try common ones. The example response showed `url` field, so for `b64` it might be `b64` or `image`.
      const imageDataBase64 =
        responseData.b64_json ||
        responseData.image_b64 ||
        responseData.image ||
        responseData.data ||
        responseData.b64;

      if (!imageDataBase64) {
        log.warn(
          "GetimgProvider: No image data found in API response (checked b64_json, image_b64, image, data, b64)",
          responseData
        );
        throw new Error("GetimgProvider: No image data found in API response.");
      }

      const resolvedMimeType =
        requestBody.output_format === "png" ? "image/png" : "image/jpeg";
      const returnedSeed = responseData.seed;

      return [
        {
          imageData: imageDataBase64,
          mimeType: resolvedMimeType,
          prompt: args.prompt,
          seed: returnedSeed, // Include seed if returned by API
          // id: responseData.id // if the API returns an ID
        },
      ];
    } catch (error: any) {
      clearTimeout(timeoutId); // Ensure timeout is cleared on any error
      if (error.name === "AbortError") {
        log.error(
          `GetimgProvider: Image generation request timed out for prompt: "${args.prompt}"`
        );
        throw new Error(
          `GetimgProvider: Request timed out after ${
            DEFAULT_TIMEOUT_MS / 1000
          } seconds.`
        );
      }
      log.error("GetimgProvider: Error generating image", {
        prompt: args.prompt,
        error: error.message,
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

export const getimgProvider = new GetimgProvider();
