import { PagePanelData } from "@/types/manga-reader";

export class PanelWebSocketManager {
  private ws: WebSocket | null = null;
  private onPanelData: (data: PagePanelData) => void;

  constructor(onPanelData: (data: PagePanelData) => void) {
    this.onPanelData = onPanelData;
  }

  connect(): void {
    this.ws = new WebSocket("ws://localhost:8000/manga-panels");

    this.ws.onmessage = (event) => {
      const data: PagePanelData = JSON.parse(event.data);
      this.onPanelData(data);
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  requestPanelData(pageId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "REQUEST_PANELS", pageId }));
    }
  }
}
