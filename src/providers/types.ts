export interface ProviderImageOutput {
  id?: string;
  imageData: string; // base64 encoded
  mimeType: string;
  prompt?: string;
  seed?: number; // Added seed based on getimg.ai response
  // Other metadata relevant to the image
}

export interface ProviderVideoOutput {
  id?: string;
  videoData?: string; // base64 encoded video data
  videoUrl?: string; // URL to the video file
  mimeType?: string;
  filepath?: string; // Local filepath if downloaded/saved by provider or orchestrator
  prompt?: string;
  // Other metadata relevant to the video
}

export interface MediaGenerationProvider {
  generateImage?(args: {
    prompt: string;
    numberOfImages?: number;
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    outputFormat?: "jpeg" | "png"; // Specify output format
  }): Promise<ProviderImageOutput[]>;

  generateVideoFromText?(args: {
    prompt: string;
    aspectRatio?: "16:9" | "9:16";
    personGeneration?: "dont_allow" | "allow_adult"; // Provider should gracefully ignore if not supported
    numberOfVideos?: number;
    durationSeconds?: number;
    enhancePrompt?: boolean;
    negativePrompt?: string;
  }): Promise<ProviderVideoOutput[]>;

  generateVideoFromImage?(args: {
    imageData: string; // base64 encoded image
    imageMimeType: string;
    prompt?: string;
    aspectRatio?: "16:9" | "9:16";
    numberOfVideos?: number;
    durationSeconds?: number;
    enhancePrompt?: boolean;
    negativePrompt?: string;
  }): Promise<ProviderVideoOutput[]>;

  listVideos?(): Promise<ProviderVideoOutput[]>;
}
