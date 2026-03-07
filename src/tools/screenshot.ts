import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";
import { renderTerminalToPng } from "../utils/render.js";

export const screenshotSchema = z.object({
  format: z.enum(["text", "png"]).optional().describe(
    "Output format: 'text' (default) returns JSON with content/cursor/dimensions, 'png' returns a color screenshot image"
  ),
});

export type ScreenshotArgs = z.infer<typeof screenshotSchema>;

export const screenshotTool = {
  name: "takeScreenshot",
  description:
    "Capture terminal state. Default format 'text' returns structured JSON with content, cursor {x, y}, and dimensions {cols, rows}. Format 'png' returns a color screenshot as an image with full ANSI color rendering. Use 'png' when you need a visual representation or want to share/save the terminal state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      format: {
        type: "string",
        enum: ["text", "png"],
        description:
          "Output format: 'text' (default) for JSON, 'png' for color screenshot image",
      },
    },
    required: [],
  },
};

export function handleScreenshot(
  manager: TerminalManager,
  args: unknown
): { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> } {
  const parsed = screenshotSchema.parse(args);
  const format = parsed.format || "text";

  if (format === "png") {
    const terminal = manager.getTerminal();
    const pngBuffer = renderTerminalToPng(terminal);

    return {
      content: [
        {
          type: "image",
          data: pngBuffer.toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  }

  // Default text format
  const screenshot = manager.takeScreenshot();
  const result = {
    content: screenshot.content,
    cursor: screenshot.cursor,
    dimensions: screenshot.dimensions,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
