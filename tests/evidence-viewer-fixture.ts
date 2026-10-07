import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import sharp from "sharp";

export async function evidenceViewerFixture(
  options: {
    pointCount?: number;
    writable?: boolean;
    failFirstUpload?: boolean;
    resolvedPointCount?: number;
    failFirstStatus?: boolean;
    imageSize?: { width: number; height: number };
    captureMarker?: {
      style: "ring" | "dot" | "arrow" | "pin";
      size: "small" | "medium" | "large";
    };
  } = {},
) {
  await mkdir(".local/evidence-qa", { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800"><rect width="1200" height="1800" fill="#f4f6f7"/><rect x="0" y="0" width="1200" height="90" fill="#17324d"/><text x="60" y="58" fill="white" font-size="30" font-family="Arial">Sample product page</text><rect x="180" y="300" width="840" height="450" rx="8" fill="white"/><text x="240" y="395" fill="#24313b" font-size="38" font-family="Arial">Build a better review workflow</text><text x="240" y="465" fill="#53616a" font-size="24" font-family="Arial">Select this text to suggest a clearer title.</text><rect x="240" y="540" width="230" height="65" rx="7" fill="#17324d"/><text x="270" y="582" fill="white" font-size="23" font-family="Arial">Start a review</text><rect x="180" y="850" width="840" height="680" rx="8" fill="white"/><text x="240" y="950" fill="#24313b" font-size="34" font-family="Arial">Everything in context</text><text x="240" y="1040" fill="#53616a" font-size="24" font-family="Arial">Screenshots, comments and suggested edits.</text><text x="60" y="1710" fill="#53616a" font-size="22" font-family="Arial">Synthetic capture for viewer verification</text></svg>`;
  const imageSize = options.imageSize ?? { width: 1200, height: 1800 };
  const screenshot = await sharp(Buffer.from(svg))
    .resize(imageSize.width, imageSize.height, { fit: "fill" })
    .webp()
    .toBuffer();
  const result = await build({
    stdin: {
      contents: `
      import React, {useState} from "react";
      import {createRoot} from "react-dom/client";
      import {ReviewEvidence} from "./src/web/threads/detail/evidence.tsx";
      import {ThreadRecordings} from "./src/web/recordings/thread-recordings.tsx";
      import {ThreadListRow} from "./src/web/threads/list-row.tsx";
      import "./src/web/styles.css";
      import "./src/web/threads/detail.css";
      import "./src/web/theme.css";
      const point = {id:"point",body:"Use a clearer title",textEdit:{original:"Build a better review workflow",replacement:"Review changes with your team"},anchor:{selector:"h1"}};
      const asset = {id:"capture",url:"/capture.webp",filename:"point-001-original.webp",width:${imageSize.width},height:${imageSize.height},rendition:"screenshot",contentType:"image/webp",markings:[
        {tool:"point",annotationId:"point",number:1,bounds:{x:.2,y:.21,width:0,height:0},endpoints:[{x:.2,y:.21}]},
        {tool:"rectangle",origin:"element",bounds:{x:.15,y:.167,width:.7,height:.25},endpoints:[]},
        {tool:"highlighter",origin:"text-selection",bounds:{x:.2,y:.20,width:.54,height:.026},endpoints:[]}
      ]};
      const base = {id:"example",body:"Clarify the page heading",updatedAt:"2026-09-30T00:00:00Z",createdAt:"2026-09-30T00:00:00Z",revision:1,category:"general",author:{name:"Example reviewer"},response:{state:"unanswered"},work:{state:"open"},context:{url:"https://example.test",viewport:{width:1200,height:800},annotations:[point],captureMarker:${JSON.stringify(options.captureMarker)}},assets:[asset],recordingModes:[]};
      if (${options.pointCount ?? 1} > 1) base.context.annotations = Array.from({length:${options.pointCount ?? 1}}, (_, index) => index === 0 ? point : ({id:"point-"+index,body:"Review request "+(index+1)+": make the supporting copy easier to understand",anchor:{selector:".section-"+index}}));
      if (${options.pointCount ?? 1} > 1) base.assets = base.context.annotations.map((item, index) => ({...asset, id:index === 0 ? "capture" : "capture-"+index, filename:"point-"+String(index+1).padStart(3,"0")+"-original.webp", markings:asset.markings.map(mark => mark.tool === "point" ? {...mark,annotationId:item.id,number:index+1} : mark)}));
      base.annotationStates = Object.fromEntries(base.context.annotations.slice(0,${options.resolvedPointCount ?? 0}).map(point => [point.id,{state:"resolved",at:"2026-10-01T00:00:00Z",actor:{name:"Example reviewer"}}]));
      fetch("/fixture/thread", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(base)});
      const rows = [base, {...base,id:"full-page",body:"Review the full page",context:{...base.context,annotations:[]},assets:[{...asset,filename:"full-page-combined.webp"}]}, {...base,id:"session",body:"Check the form interaction",context:{...base.context,annotations:[]},assets:[],recordingModes:["session"]}, {...base,id:"video",body:"Watch the menu animation",context:{...base.context,annotations:[]},assets:[],recordingModes:["video"]}, {...base,id:"text",body:"Update the help copy",context:{...base.context,annotations:[]},assets:[]}];
      function App(){ const [full,setFull] = useState(false); const [current,setCurrent] = useState(base); return <main style={{maxWidth:1200,margin:"0 auto",padding:16}}><h1>Feedback evidence review</h1><section aria-label="Feedback examples">{rows.map(thread=><ThreadListRow key={thread.id} thread={thread} actor={{kind:"human"}} project={{permissions:{}}} filters={{}} draft={{}} offset={0} selected={false} apply={()=>{}} onSelectionChange={()=>{}} onPrioritySaved={()=>{}} onStatusSaved={()=>{}} />)}</section><button onClick={()=>setFull(!full)}>Switch capture example</button><ThreadRecordings thread={base}/><div style={{maxWidth:760}}><ReviewEvidence thread={full ? {...current,assets:[{...current.assets[0],id:"full",filename:"full-page-combined.webp"}]} : current} canWrite={${!!options.writable}} canResolve={${!!options.writable}} canMaintain={${!!options.writable}} onSaved={setCurrent}/></div></main> }
      createRoot(document.getElementById("root")).render(<App/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    outdir: "out",
    jsx: "automatic",
    loader: { ".woff2": "dataurl", ".woff": "dataurl" },
  });
  let recordingRequests = 0;
  const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const uploads: any[] = [];
  let savedScreenshot = screenshot;
  const statusUpdates: any[] = [];
  let latestThread: any;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/api/threads.get") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          data: latestThread ?? { id: "example", revision: 1 },
        }),
      );
    } else if (
      ["/api/threads.status", "/api/threads.annotationStatus"].includes(req.url!)
    ) {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/threads.status") {
        statusUpdates.push(input);
        if (options.failFirstStatus && statusUpdates.length === 1)
          latestThread.revision++;
      }
      if (input.revision !== latestThread.revision) {
        res.statusCode = 409;
        res.end(
          JSON.stringify({
            ok: false,
            error: { code: "CONFLICT", message: "Thread changed" },
          }),
        );
        return;
      }
      latestThread = { ...latestThread, revision: latestThread.revision + 1 };
      if (req.url === "/api/threads.status") latestThread.work = { state: input.state };
      else
        latestThread.annotationStates = {
          ...latestThread.annotationStates,
          [input.annotationId]: {
            state: input.state,
            at: "2026-10-01T00:00:00Z",
            actor: { name: "Example reviewer" },
          },
        };
      res.end(JSON.stringify({ ok: true, data: latestThread }));
    } else if (req.url === "/api/threads.annotationPlan") {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      latestThread = {
        ...latestThread,
        revision: latestThread.revision + 1,
        annotationPlans: {
          ...latestThread.annotationPlans,
          [input.annotationId]: input.workPlan,
        },
      };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, data: latestThread }));
    } else if (req.url === "/api/assets.upload") {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      uploads.push(input);
      res.setHeader("Content-Type", "application/json");
      if (options.failFirstUpload && uploads.length === 1) {
        res.statusCode = 503;
        res.end(
          JSON.stringify({
            ok: false,
            error: { code: "TEMPORARY", message: "Synthetic upload interruption" },
          }),
        );
        return;
      }
      savedScreenshot = await sharp(
        Buffer.from(input.imageBase64.split(",")[1], "base64"),
      )
        .webp()
        .toBuffer();
      latestThread = {
        ...latestThread,
        revision: (latestThread?.revision ?? 1) + 1,
        assets: latestThread.assets.map((asset: any) =>
          asset.id === input.replacesAssetId
            ? {
                ...asset,
                id: "saved",
                baseAssetId: asset.baseAssetId ?? asset.id,
                url: "/saved.webp",
                markup: input.markup,
              }
            : asset,
        ),
      };
      res.end(
        JSON.stringify({
          ok: true,
          data: { asset: { id: "saved" }, thread: latestThread },
        }),
      );
    } else if (req.url === "/fixture/thread") {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      latestThread = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.end("ok");
    } else if (req.url === "/saved.webp") {
      res.setHeader("Content-Type", "image/webp");
      res.end(savedScreenshot);
    } else if (req.url?.startsWith("/api/assets/")) {
      res.setHeader("Content-Type", "image/webp");
      res.end(screenshot);
    } else if (req.url?.startsWith("/capture.webp")) {
      res.setHeader("Content-Type", "image/webp");
      res.end(screenshot);
    } else if (req.url === "/api/recordings.list") {
      recordingRequests++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, data: { items: [] } }));
    } else if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(script);
    } else if (req.url === "/bundle.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidence viewer QA</title><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script></html>',
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return {
    uploads,
    statusUpdates,
    url: `http://127.0.0.1:${address.port}`,
    recordingRequests: () => recordingRequests,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}
