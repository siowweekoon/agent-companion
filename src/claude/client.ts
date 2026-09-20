import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

export const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
