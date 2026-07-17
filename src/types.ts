export type InkTool = "pen" | "highlighter" | "eraser" | "lasso" | "pan";
export type StrokeTool = "pen" | "highlighter";

export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  time: number;
}

export interface InkStroke {
  id: string;
  tool: StrokeTool;
  color: string;
  width: number;
  opacity: number;
  points: InkPoint[];
}

export interface InkDocument {
  version: 1;
  notePath: string;
  strokes: InkStroke[];
  updatedAt: number;
}

export interface InkDrawing {
  version: 1;
  width: number;
  height: number;
  background: "paper";
  strokes: InkStroke[];
  updatedAt: number;
}

export interface InkSettings {
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  eraserWidth: number;
  pressureSensitivity: number;
  palmRejection: boolean;
  allowFingerDrawing: boolean;
  allowMouseDrawing: boolean;
  toolbarPosition: "top" | "bottom";
  drawingFolder: string;
  defaultCanvasWidth: number;
  defaultCanvasHeight: number;
  defaultEmbedWidth: number;
  defaultEmbedHeight: number;
}

export interface InkPluginData {
  version: 1;
  settings: InkSettings;
  documents: Record<string, InkDocument>;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const DEFAULT_SETTINGS: InkSettings = {
  penColor: "adaptive",
  penWidth: 3.2,
  highlighterColor: "#facc15",
  highlighterWidth: 18,
  eraserWidth: 20,
  pressureSensitivity: 0.72,
  palmRejection: true,
  allowFingerDrawing: false,
  allowMouseDrawing: true,
  toolbarPosition: "bottom",
  drawingFolder: "Inkplane",
  defaultCanvasWidth: 1600,
  defaultCanvasHeight: 1200,
  defaultEmbedWidth: 800,
  defaultEmbedHeight: 600
};
