import { z } from 'zod';
// Removed: import { GoogleGenAI } from '@google/genai';
// Removed: import { veoClient } from '../services/veoClient.js';
import { CallToolResult, ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../utils/logger.js';
import appConfig from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { falProvider } from "../providers/falProvider.js";
import { googleProvider } from "../providers/googleProvider.js";
import { veoProvider } from "../providers/veoProvider.js";
import { getimgProvider } from "../providers/getimgProvider.js";
import {
  MediaGenerationProvider,
  ProviderImageOutput,
  ProviderVideoOutput,
} from "../providers/types.js";

// Removed: const ai = new GoogleGenAI({ apiKey: appConfig.GOOGLE_API_KEY });

const IMAGE_STORAGE_DIR = path.join(appConfig.STORAGE_DIR, 'images');

(async () => {
  try {
    await fs.mkdir(IMAGE_STORAGE_DIR, { recursive: true });
  } catch (error) {
    log.fatal("Failed to create image storage directory:", error);
    process.exit(1);
  }
})();

async function saveGeneratedImage(
  imageBytes: string,
  prompt: string,
  mimeType: string = "image/png"
): Promise<{ id: string; filepath: string; mimeType: string; prompt: string }> {
  try {
    const id = uuidv4();
    let extension = ".png";
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
      extension = ".jpg";
    } else if (mimeType === "image/webp") {
      extension = ".webp";
    }

    const filepath = path.resolve(IMAGE_STORAGE_DIR, `${id}${extension}`);
    const buffer = Buffer.from(imageBytes, "base64");
    await fs.writeFile(filepath, buffer);

    const metadata = {
      id,
      createdAt: new Date().toISOString(),
      prompt,
      mimeType,
      size: buffer.length,
      filepath,
    };

    const metadataPath = path.resolve(IMAGE_STORAGE_DIR, `${id}.json`);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    log.info(`Image saved successfully with ID: ${id}`);
    return { id, filepath, mimeType, prompt };
  } catch (error) {
    log.error("Error saving generated image:", error);
    throw error;
  }
}

const AspectRatioSchema = z.enum(['16:9', '9:16']);
const PersonGenerationSchema = z.enum(['dont_allow', 'allow_adult']);

// Provider selection (can be made more dynamic, e.g., via config or args)
const defaultVideoProviderName = 'fal'; // Fal is the new default for video
const defaultImageProviderName = 'getimg'; // getimg is the new default for images

function getVideoProvider(providerName?: string): MediaGenerationProvider {
  const name = providerName || defaultVideoProviderName;
  if (name === 'fal') return falProvider;
  if (name === 'veo') return veoProvider;
  // Potentially add other video providers here
  log.warn(`Unknown or unsupported video provider specified: ${name}. Falling back to default: ${defaultVideoProviderName}`);
  if (defaultVideoProviderName === 'fal') return falProvider;
  if (defaultVideoProviderName === 'veo') return veoProvider; // Should match the actual default
  throw new Error(`Default video provider ${defaultVideoProviderName} not configured correctly.`);
}

function getImageProvider(providerName?: string): MediaGenerationProvider {
  const name = providerName || defaultImageProviderName;
  if (name === 'google') return googleProvider;
  if (name === "getimg") return getimgProvider;
  // Potentially add other image providers here
  log.warn(
    `Unknown or unsupported image provider specified: ${name}. Falling back to default: ${defaultImageProviderName}`
  );
  if (defaultImageProviderName === "getimg") return getimgProvider;
  if (defaultImageProviderName === 'google') return googleProvider;
  throw new Error(`Default image provider ${defaultImageProviderName} not configured correctly.`);
}


export async function generateVideoFromText(args: {
  prompt: string;
  aspectRatio?: "16:9" | "9:16";
  personGeneration?: "dont_allow" | "allow_adult";
  numberOfVideos?: 1 | 2;
  durationSeconds?: number;
  enhancePrompt?: boolean | string;
  negativePrompt?: string;
  includeFullData?: boolean | string;
  autoDownload?: boolean | string; // This now influences if we try to ensure a local filepath
  provider?: string; // e.g., 'fal', 'veo'
}): Promise<CallToolResult> {
  try {
    const currentProviderName = args.provider || defaultVideoProviderName;
    log.info(
      `Generating video from text prompt. Provider: ${currentProviderName}. Args: ${JSON.stringify(
        args,
        null,
        2
      )}`
    );

    const enhancePromptBool =
      typeof args.enhancePrompt === "string"
        ? args.enhancePrompt.toLowerCase() === "true" ||
          args.enhancePrompt === "1"
        : args.enhancePrompt ?? false;
    const includeFullDataBool =
      typeof args.includeFullData === "string"
        ? args.includeFullData.toLowerCase() === "true" ||
          args.includeFullData === "1"
        : args.includeFullData ?? false;
    // autoDownload influences provider behavior if it can, or post-processing if URL is returned.
    // For VeoProvider, it already handles download. For FalProvider, it returns URL.
    // The autoDownload flag here is more of a hint for the user about their intent.

    const provider = getVideoProvider(currentProviderName);
    if (!provider.generateVideoFromText) {
      throw new Error(
        `Provider ${currentProviderName} does not support generateVideoFromText`
      );
    }

    const providerResults = await provider.generateVideoFromText({
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      personGeneration: args.personGeneration,
      numberOfVideos: args.numberOfVideos,
      durationSeconds: args.durationSeconds,
      enhancePrompt: enhancePromptBool,
      negativePrompt: args.negativePrompt,
    });

    if (!providerResults || providerResults.length === 0) {
      throw new Error("No video generated by the provider.");
    }
    const result = providerResults[0]; // Taking the first result

    // If provider is Fal (which returns URL) and user wants autoDownload (implicitly)
    // we currently don't implement the download step here. FalProvider returns a URL.
    // VeoProvider returns filepath and videoData directly.

    const responseContent: Array<TextContent | ImageContent> = [];
    if (includeFullDataBool && result.videoData) {
      responseContent.push({
        type: "image", // MCP SDK limitation: using 'image' for video data
        mimeType: result.mimeType || "video/mp4",
        data: result.videoData,
      });
    }

    responseContent.push({
      type: "text",
      text: JSON.stringify(
        {
          success: true,
          message: `Video generated successfully using ${currentProviderName} provider.`,
          videoId: result.id || uuidv4(),
          resourceUri: `videos://${result.id || "unknown"}`,
          filepath: result.filepath, // Might be undefined if only URL (e.g. Fal)
          videoUrl: result.videoUrl, // Fal provides this
          metadata: {
            prompt: result.prompt,
            provider: currentProviderName,
            // any other relevant data from result object
          },
        },
        null,
        2
      ),
    });

    return { content: responseContent };
  } catch (error) {
    log.error("Error generating video from text:", error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error generating video: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

export async function generateVideoFromImage(args: {
  image: string | { type: "image"; mimeType: string; data: string };
  prompt?: string;
  aspectRatio?: "16:9" | "9:16";
  numberOfVideos?: 1 | 2;
  durationSeconds?: number;
  enhancePrompt?: boolean | string;
  negativePrompt?: string;
  includeFullData?: boolean | string;
  autoDownload?: boolean | string;
  provider?: string; // e.g., 'veo' (fal doesn't support this yet in our impl)
}): Promise<CallToolResult> {
  try {
    const currentProviderName = args.provider || defaultVideoProviderName;
    log.info("Generating video from image", {
      provider: currentProviderName,
      ...args,
    });

    let imageDataBase64: string;
    let imageMimeType: string;

    if (typeof args.image === "string") {
      // This path implies image is a URL or potentially a local file path NOT base64 data.
      // Providers typically expect base64 data or a public URL they can fetch.
      // If it's a local path, it would need to be read and converted to base64 first.
      // For simplicity, current providers (Veo) expect base64 for image input.
      // This part of logic might need refinement if we pass file paths directly.
      // Assuming for now if string, it must be base64 or a format provider can handle (e.g. a URL for some providers)
      // However, our VeoProvider expects base64.
      // Let's assume if string, it's base64. This is a simplification.
      log.warn(
        "generateVideoFromImage: Received image as string. Assuming it is base64 encoded data. If it is a URL/path, provider might fail."
      );
      imageDataBase64 = args.image;
      imageMimeType = "image/png"; // Defaulting, ideally this should be known
    } else {
      imageDataBase64 = args.image.data;
      imageMimeType = args.image.mimeType;
    }

    const enhancePromptBool =
      typeof args.enhancePrompt === "string"
        ? args.enhancePrompt.toLowerCase() === "true" ||
          args.enhancePrompt === "1"
        : args.enhancePrompt ?? false;
    const includeFullDataBool =
      typeof args.includeFullData === "string"
        ? args.includeFullData.toLowerCase() === "true" ||
          args.includeFullData === "1"
        : args.includeFullData ?? false;

    const provider = getVideoProvider(currentProviderName);
    if (!provider.generateVideoFromImage) {
      throw new Error(
        `Provider ${currentProviderName} does not support generateVideoFromImage`
      );
    }

    const providerResults = await provider.generateVideoFromImage({
      imageData: imageDataBase64,
      imageMimeType: imageMimeType,
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      numberOfVideos: args.numberOfVideos,
      durationSeconds: args.durationSeconds,
      enhancePrompt: enhancePromptBool,
      negativePrompt: args.negativePrompt,
    });

    if (!providerResults || providerResults.length === 0) {
      throw new Error("No video generated by the provider.");
    }
    const result = providerResults[0];

    const responseContent: Array<TextContent | ImageContent> = [];
    if (includeFullDataBool && result.videoData) {
      responseContent.push({
        type: "image", // MCP SDK limitation
        mimeType: result.mimeType || "video/mp4",
        data: result.videoData,
      });
    }

    responseContent.push({
      type: "text",
      text: JSON.stringify(
        {
          success: true,
          message: `Video generated successfully from image using ${currentProviderName} provider.`,
          videoId: result.id || uuidv4(),
          resourceUri: `videos://${result.id || "unknown"}`,
          filepath: result.filepath,
          videoUrl: result.videoUrl,
          metadata: {
            prompt: result.prompt,
            provider: currentProviderName,
          },
        },
        null,
        2
      ),
    });

    return { content: responseContent };
  } catch (error) {
    log.error("Error generating video from image:", error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error generating video from image: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

export async function generateImage(args: {
  prompt: string;
  numberOfImages?: number;
  includeFullData?: boolean | string;
  provider?: string; // e.g., 'google'
}): Promise<CallToolResult> {
  try {
    const currentProviderName = args.provider || defaultImageProviderName;
    log.info("Generating image from text prompt", {
      provider: currentProviderName,
      ...args,
    });

    const provider = getImageProvider(currentProviderName);
    if (!provider.generateImage) {
      throw new Error(
        `Provider ${currentProviderName} does not support generateImage`
      );
    }

    const providerResults = await provider.generateImage({
      prompt: args.prompt,
      numberOfImages: args.numberOfImages || 1,
    });

    if (!providerResults || providerResults.length === 0) {
      throw new Error("No images generated by the provider.");
    }
    // Assuming we save the first image if multiple are returned by provider,
    // or orchestrator could loop and save all.
    // For now, work with the first one for simplicity matching original behavior.
    const firstImageOutput = providerResults[0];

    // Save the generated image to disk using the existing utility
    const savedImageInfo = await saveGeneratedImage(
      firstImageOutput.imageData,
      firstImageOutput.prompt || args.prompt, // Use prompt from provider if available, else original
      firstImageOutput.mimeType
    );

    const includeFullDataBool =
      typeof args.includeFullData === "string"
        ? args.includeFullData.toLowerCase() === "true" ||
          args.includeFullData === "1"
        : args.includeFullData !== false; // Default to true as in original

    const responseContent: Array<TextContent | ImageContent> = [];
    if (includeFullDataBool) {
      responseContent.push({
        type: "image",
        mimeType: savedImageInfo.mimeType,
        data: firstImageOutput.imageData, // Send back the original base64 data
      });
    }

    responseContent.push({
      type: "text",
      text: JSON.stringify(
        {
          success: true,
          message: `Image generated successfully using ${currentProviderName} provider.`,
          imageId: savedImageInfo.id,
          resourceUri: `images://${savedImageInfo.id}`,
          filepath: savedImageInfo.filepath,
          prompt: savedImageInfo.prompt, // Prompt used for saving (and hopefully generation)
          provider: currentProviderName,
        },
        null,
        2
      ),
    });

    return { content: responseContent };
  } catch (error) {
    log.error("Error generating image:", error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error generating image: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

export async function generateVideoFromGeneratedImage(args: {
  prompt: string; // Prompt for image generation
  videoPrompt?: string; // Optional separate prompt for video generation
  numberOfImages?: number; // For image generation stage
  aspectRatio?: "16:9" | "9:16"; // For video generation stage
  personGeneration?: "dont_allow" | "allow_adult"; // For video generation stage
  numberOfVideos?: 1 | 2; // For video generation stage
  durationSeconds?: number; // For video generation stage
  enhancePrompt?: boolean | string; // For video generation stage (can also apply to image?)
  negativePrompt?: string; // For video generation stage
  includeFullData?: boolean | string; // For final response
  autoDownload?: boolean | string;
  imageProvider?: string;
  videoProvider?: string;
}): Promise<CallToolResult> {
  try {
    const currentImageProviderName =
      args.imageProvider || defaultImageProviderName;
    const currentVideoProviderName =
      args.videoProvider || defaultVideoProviderName;

    log.info("Generating video from generated image", {
      imageProvider: currentImageProviderName,
      videoProvider: currentVideoProviderName,
      ...args,
    });

    // --- 1. Generate Image ---
    const imageProvider = getImageProvider(currentImageProviderName);
    if (!imageProvider.generateImage) {
      throw new Error(
        `Image Provider ${currentImageProviderName} does not support generateImage`
      );
    }
    const imageProviderResults = await imageProvider.generateImage({
      prompt: args.prompt,
      numberOfImages: args.numberOfImages || 1,
    });

    if (!imageProviderResults || imageProviderResults.length === 0) {
      throw new Error("No image generated by the image provider.");
    }
    const generatedImageData = imageProviderResults[0];

    // Save the intermediate image
    const savedImageInfo = await saveGeneratedImage(
      generatedImageData.imageData,
      generatedImageData.prompt || args.prompt,
      generatedImageData.mimeType
    );

    // --- 2. Generate Video from the saved/generated image ---
    const videoProvider = getVideoProvider(currentVideoProviderName);
    if (!videoProvider.generateVideoFromImage) {
      throw new Error(
        `Video Provider ${currentVideoProviderName} does not support generateVideoFromImage`
      );
    }

    const enhancePromptBool =
      typeof args.enhancePrompt === "string"
        ? args.enhancePrompt.toLowerCase() === "true" ||
          args.enhancePrompt === "1"
        : args.enhancePrompt ?? false;

    const videoProviderResults = await videoProvider.generateVideoFromImage({
      imageData: generatedImageData.imageData, // Pass base64 data
      imageMimeType: savedImageInfo.mimeType,
      prompt: args.videoPrompt || args.prompt, // Use videoPrompt if available, else original image prompt
      aspectRatio: args.aspectRatio,
      numberOfVideos: args.numberOfVideos,
      durationSeconds: args.durationSeconds,
      enhancePrompt: enhancePromptBool,
      negativePrompt: args.negativePrompt,
    });

    if (!videoProviderResults || videoProviderResults.length === 0) {
      throw new Error(
        "No video generated by the video provider from the image."
      );
    }
    const videoResult = videoProviderResults[0];

    // --- 3. Prepare Response ---
    const includeFullDataBool =
      typeof args.includeFullData === "string"
        ? args.includeFullData.toLowerCase() === "true" ||
          args.includeFullData === "1"
        : args.includeFullData ?? false;

    const responseContent: Array<TextContent | ImageContent> = [];

    // Always include the generated image in the response as per original logic trace
    responseContent.push({
      type: "image",
      mimeType: savedImageInfo.mimeType,
      data: generatedImageData.imageData,
    });

    if (includeFullDataBool && videoResult.videoData) {
      responseContent.push({
        type: "image", // MCP SDK limitation
        mimeType: videoResult.mimeType || "video/mp4",
        data: videoResult.videoData,
      });
    }

    responseContent.push({
      type: "text",
      text: JSON.stringify(
        {
          success: true,
          message: "Video generated from generated image successfully.",
          imageId: savedImageInfo.id,
          imageResourceUri: `images://${savedImageInfo.id}`,
          imageFilepath: savedImageInfo.filepath,
          videoId: videoResult.id || uuidv4(),
          videoResourceUri: `videos://${videoResult.id || "unknown"}`,
          videoFilepath: videoResult.filepath,
          videoUrl: videoResult.videoUrl,
          metadata: {
            imagePrompt: args.prompt,
            videoPrompt: args.videoPrompt || args.prompt,
            imageProvider: currentImageProviderName,
            videoProvider: currentVideoProviderName,
            // other relevant data from videoResult or savedImageInfo
          },
        },
        null,
        2
      ),
    });

    return { content: responseContent };
  } catch (error) {
    log.error("Error generating video from generated image:", error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error generating video from generated image: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

// getImage, listGeneratedImages, listGeneratedVideos remain largely unchanged
// as they interact with local storage (for images) or a specific client (Veo for listVideos).
// listGeneratedVideos might need adjustment if Fal or other providers offer listing capabilities
// or if we want to list videos based on locally stored metadata (if any for non-Veo videos).

async function getImageMetadata(id: string): Promise<any> {
  try {
    const metadataPath = path.resolve(IMAGE_STORAGE_DIR, `${id}.json`);
    const metadataJson = await fs.readFile(metadataPath, "utf-8");
    return JSON.parse(metadataJson);
  } catch (error) {
    log.error(`Error getting metadata for image ${id}:`, error);
    throw new Error(`Image metadata not found: ${id}`);
  }
}

export async function getImage(args: {
  id: string;
  includeFullData?: boolean | string;
}): Promise<CallToolResult> {
  try {
    log.info(`Getting image with ID: ${args.id}`);
    const metadata = await getImageMetadata(args.id);

    const includeFullData =
      typeof args.includeFullData === "string"
        ? args.includeFullData.toLowerCase() === "true" ||
          args.includeFullData === "1"
        : args.includeFullData !== false;

    const responseContent: Array<TextContent | ImageContent> = [];
    if (includeFullData && metadata.filepath) {
      try {
        const imageData = await fs.readFile(metadata.filepath);
        responseContent.push({
          type: "image",
          mimeType: metadata.mimeType || "image/png",
          data: imageData.toString("base64"),
        });
      } catch (error) {
        log.error(`Error reading image file ${metadata.filepath}:`, error);
      }
    }

    responseContent.push({
      type: "text",
      text: JSON.stringify(
        {
          success: true,
          message: "Image retrieved successfully",
          imageId: metadata.id,
          resourceUri: `images://${metadata.id}`,
          filepath: metadata.filepath,
          prompt: metadata.prompt,
          createdAt: metadata.createdAt,
          mimeType: metadata.mimeType,
          size: metadata.size,
        },
        null,
        2
      ),
    });
    return { content: responseContent };
  } catch (error) {
    log.error(`Error getting image:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting image: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

export async function listGeneratedImages(): Promise<CallToolResult> {
  try {
    log.info("Listing all generated images");
    const files = await fs.readdir(IMAGE_STORAGE_DIR);
    const metadataFiles = files.filter((file) => file.endsWith(".json"));

    const imagesPromises = metadataFiles.map(async (file) => {
      const filePath = path.resolve(IMAGE_STORAGE_DIR, file);
      try {
        const metadataJson = await fs.readFile(filePath, "utf-8");
        return JSON.parse(metadataJson);
      } catch (error) {
        log.error(`Error reading image metadata file ${filePath}:`, error);
        return null;
      }
    });

    const images = (await Promise.all(imagesPromises)).filter(
      (image) => image !== null
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              count: images.length,
              images: images.map((image) => ({
                id: image.id,
                createdAt: image.createdAt,
                prompt: image.prompt,
                resourceUri: `images://${image.id}`,
                filepath: image.filepath,
                mimeType: image.mimeType,
                size: image.size,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    log.error("Error listing images:", error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error listing images: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

// listGeneratedVideos currently relies on veoClient.listVideos().
// If Fal is the default and doesn't have a similar listing feature through its SDK,
// this function will effectively list only Veo videos or error if veoProvider isn't used.
// For a truly generic solution, video metadata would also need to be stored locally like images.
// Keeping original Veo-centric logic for now.
export async function listGeneratedVideos(): Promise<CallToolResult> {
  try {
    const provider = getVideoProvider(); // Gets default or could be made to accept arg
    log.info("Attempting to list videos using provider.");

    if (provider.listVideos && typeof provider.listVideos === "function") {
      const videos = await provider.listVideos();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                count: videos.length,
                videos: videos.map((video) => ({
                  id: video.id,
                  createdAt: (video as any).createdAt, // createdAt is not in ProviderVideoOutput, cast or add to type
                  prompt: video.prompt,
                  resourceUri: `videos://${video.id}`,
                  filepath: video.filepath,
                  videoUrl: video.videoUrl,
                })),
                provider: provider.constructor.name, // e.g. 'VeoProvider'
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      log.warn(
        `Video listing is not supported by the current default video provider: ${provider.constructor.name}`
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                count: 0,
                videos: [],
                message: `Video listing is not supported by the current default video provider: ${provider.constructor.name}. Only providers with a listVideos method (e.g., VeoProvider) support this. FalProvider (default) does not.`,
                provider: provider.constructor.name,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  } catch (error) {
    log.error("Error listing videos:", error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error listing videos: ${
            error instanceof Error ? error.message : String(error)
          }. This may be due to provider capabilities. Provider: ${
            getVideoProvider().constructor.name
          }`,
        },
      ],
    };
  }
}
