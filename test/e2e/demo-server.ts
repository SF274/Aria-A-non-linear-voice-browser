import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const demoDir = path.resolve(import.meta.dirname, "../../demo");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

export interface DemoServerHandle {
  url: string;
  close: () => Promise<void>;
}

export function startDemoServer(preferredPort = 5174): Promise<DemoServerHandle> {
  return new Promise((resolve, reject) => {
    const requestListener: http.RequestListener = (req, res) => {
      const rawPath = req.url?.split("?")[0] || "/";
      const normalizedPath = rawPath === "/" ? "index.html" : rawPath.replace(/^\//, "");
      const filePath = path.resolve(demoDir, normalizedPath);

      if (!filePath.startsWith(demoDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(fs.readFileSync(filePath));
    };

    const server = http.createServer(requestListener);

    server.listen(preferredPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : preferredPort;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((resClose) => server.close(() => resClose())),
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // If preferred port is in use, start on an ephemeral port
        const fallbackServer = http.createServer(requestListener);
        fallbackServer.listen(0, "127.0.0.1", () => {
          const addr = fallbackServer.address();
          const port = typeof addr === "object" && addr ? addr.port : 0;
          resolve({
            url: `http://127.0.0.1:${port}`,
            close: () => new Promise((resClose) => fallbackServer.close(() => resClose())),
          });
        });
        fallbackServer.on("error", (e) => reject(e));
      } else {
        reject(err);
      }
    });
  });
}
