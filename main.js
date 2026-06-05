var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DBMLVisualizerPlugin,
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DBMLVisualizerPlugin = class extends import_obsidian.Plugin {
  async onload() {
    const processor = async (source, el, ctx) => {
      try {
        if (source.trim() === "") {
          return;
        }
        const { tables, relations } = this.parseDBML(source);
        const title = await this.extractCodeBlockTitle(source, el, ctx);
        const { tableMap, bounds } = this.layoutTables(tables, relations);
        this.renderERD(
          el,
          tables,
          relations,
          tableMap,
          bounds,
          title != null ? title : void 0,
        );
      } catch (e) {
        el.createEl("pre", { text: "Error parsing DBML:\n" + e.message });
      }
    };
    this.registerMarkdownCodeBlockProcessor("dbml", processor);
    this.registerMarkdownCodeBlockProcessor("DBML", processor);
  }
  async extractCodeBlockTitle(source, el, ctx) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof import_obsidian.TFile)) {
      return null;
    }
    const text = await this.app.vault.read(file);
    const lines = text.split(/\r?\n/);
    const parseFenceMeta = (infoString) => {
      var _a;
      const trimmed = infoString.trim();
      if (!trimmed.toLowerCase().startsWith("dbml")) {
        return null;
      }
      const titleMatch =
        (_a = trimmed.match(/title\s*=\s*"([^"]+)"/i)) != null
          ? _a
          : trimmed.match(/title\s*=\s*'([^']+)'/i);
      if (!titleMatch) {
        return null;
      }
      const title = titleMatch[1].trim();
      return title.length ? title : null;
    };
    const sectionInfo = ctx.getSectionInfo(el);
    if (sectionInfo) {
      let lineIndex = sectionInfo.lineStart;
      if (lineIndex >= 0 && lines[lineIndex].trim().startsWith("```")) {
        const infoString = lines[lineIndex].trim().slice(3).trim();
        const title = parseFenceMeta(infoString);
        if (title) return title;
      }
      if (lineIndex - 1 >= 0 && lines[lineIndex - 1].trim().startsWith("```")) {
        const infoString = lines[lineIndex - 1].trim().slice(3).trim();
        const title = parseFenceMeta(infoString);
        if (title) return title;
      }
    }
    const firstLine = source.split(/\r?\n/).find((l) => l.trim() !== "");
    if (firstLine) {
      let startPos = 0;
      while (startPos < text.length) {
        const idx = text.indexOf(firstLine, startPos);
        if (idx === -1) break;
        const textBefore = text.substring(0, idx);
        const lastFenceIdx = textBefore.lastIndexOf("```");
        if (lastFenceIdx !== -1) {
          const textToEndOfFence = textBefore.substring(lastFenceIdx);
          const fenceLine = textToEndOfFence.split(/\r?\n/)[0];
          if (fenceLine.trim().toLowerCase().startsWith("```dbml")) {
            const infoString = fenceLine.trim().slice(3).trim();
            const title = parseFenceMeta(infoString);
            if (title) return title;
          }
        }
        startPos = idx + 1;
      }
    } else {
      const emptyBlockRegex = /```dbml([^\n]*)\s*```/gi;
      let match;
      while ((match = emptyBlockRegex.exec(text)) !== null) {
        const infoString = match[1].trim();
        const title = parseFenceMeta(infoString);
        if (title) return title;
      }
    }
    return null;
  }
  parseDBML(source) {
    const tables = [];
    const relations = [];
    const tableMap = {};
    const tableRegex = /(\w+)\s*\{([\s\S]*?)\}/g;
    let match;
    while ((match = tableRegex.exec(source)) !== null) {
      const name = match[1];
      const colsStr = match[2];
      const columns = [];
      colsStr.split("\n").forEach((line) => {
        line = line.trim().replace(/\/\/.*$/, "");
        if (!line) return;
        const colMatch = line.match(
          /^(\w+)\s+([\w]+(?:\([^)]*\))?)(?:\s*\[(.*?)\])?/,
        );
        if (colMatch) {
          columns.push({
            name: colMatch[1],
            type: colMatch[2],
            pk: colMatch[3] ? colMatch[3].includes("pk") : false,
          });
        }
      });
      let tableWidth = 220;
      if (columns.length > 0) {
        const maxColLen = columns.reduce((max, c) => {
          const nameStr = c.pk ? `PK ${c.name}` : c.name;
          const len = nameStr.length + c.type.length + 2;
          return len > max ? len : max;
        }, 0);
        const titleLen = name.length;
        const maxLen = Math.max(maxColLen, titleLen);
        tableWidth = Math.max(220, maxLen * 8 + 24);
      } else {
        const titleLen = name.length;
        tableWidth = Math.max(220, titleLen * 8 + 24);
      }
      tables.push({
        name,
        columns,
        x: 0,
        y: 0,
        width: tableWidth,
        height: 40 + columns.length * 28,
        isGhost: false,
      });
      tableMap[name] = true;
    }
    const relRegex = /(\w+)\.(\w+)\s*(<>|>|<)\s*(\w+)\.(\w+)/g;
    while ((match = relRegex.exec(source)) !== null) {
      const fromTable = match[1];
      const toTable = match[4];
      relations.push({
        fromTable,
        fromCol: match[2],
        type: match[3],
        toTable,
        toCol: match[5],
      });
      const createGhost = (tblName, colName) => {
        const titleText = `${tblName} (ref)`;
        const tableWidth = Math.max(220, (colName.length + 7 + 7 + 2) * 8 + 24);
        tables.push({
          name: tblName,
          columns: [{ name: colName, type: "unknown", pk: false }],
          x: 0,
          y: 0,
          width: tableWidth,
          height: 68,
          isGhost: true,
        });
        tableMap[tblName] = true;
      };
      if (!tableMap[fromTable]) createGhost(fromTable, match[2]);
      if (!tableMap[toTable]) createGhost(toTable, match[5]);
    }
    return { tables, relations };
  }
  layoutTables(tables, relations) {
    const tableMap = {};
    tables.forEach((t) => (tableMap[t.name] = t));
    const inDegree = {};
    const adj = {};
    tables.forEach((t) => {
      inDegree[t.name] = 0;
      adj[t.name] = [];
    });
    relations.forEach((r) => {
      if (tableMap[r.toTable] && tableMap[r.fromTable]) {
        adj[r.toTable].push(r.fromTable);
        inDegree[r.fromTable]++;
      }
    });
    const layers = [];
    const visited = /* @__PURE__ */ new Set();
    while (visited.size < tables.length) {
      let queue = tables
        .filter((t) => inDegree[t.name] === 0 && !visited.has(t.name))
        .map((t) => t.name);
      if (queue.length === 0 && tables.length > 0) {
        let minDeg = Infinity;
        let candidates = [];
        for (const t of tables) {
          if (!visited.has(t.name)) {
            if (inDegree[t.name] < minDeg) {
              minDeg = inDegree[t.name];
              candidates = [t.name];
            } else if (inDegree[t.name] === minDeg) {
              candidates.push(t.name);
            }
          }
        }
        if (candidates.length > 0) {
          queue.push(candidates[0]);
          inDegree[candidates[0]] = 0;
        }
      }
      if (queue.length === 0) break;
      while (queue.length > 0) {
        layers.push([...queue]);
        const nextQueue = [];
        for (const node of queue) {
          visited.add(node);
          for (const child of adj[node]) {
            if (!visited.has(child)) {
              inDegree[child]--;
              if (inDegree[child] === 0) {
                nextQueue.push(child);
              }
            }
          }
        }
        queue = nextQueue;
      }
    }
    const xSpacing = 380;
    const ySpacing = 60;
    let maxRight = 0;
    let maxBottom = 0;
    layers.forEach((layer, layerIndex) => {
      let currentY = 0;
      layer.forEach((tableName) => {
        const t = tableMap[tableName];
        t.x = layerIndex * xSpacing;
        t.y = currentY;
        currentY += t.height + ySpacing;
      });
    });
    const resolveOverlaps = () => {
      let moved = false;
      const sortedTables = tables.slice().sort((a, b) => a.y - b.y);
      for (let i = 0; i < sortedTables.length; i++) {
        const a = sortedTables[i];
        for (let j = 0; j < i; j++) {
          const b = sortedTables[j];
          if (
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y
          ) {
            a.y = b.y + b.height + ySpacing;
            moved = true;
          }
        }
      }
      return moved;
    };
    while (resolveOverlaps()) {}
    tables.forEach((t) => {
      maxRight = Math.max(maxRight, t.x + t.width);
      maxBottom = Math.max(maxBottom, t.y + t.height);
    });
    return {
      tableMap,
      bounds: { width: maxRight + 80, height: maxBottom + 80 },
    };
  }
  escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "&":
          return "&amp;";
        case "'":
          return "&apos;";
        case '"':
          return "&quot;";
      }
      return c;
    });
  }
  generateRelationsSVG(relations, tableMap) {
    let svg = "";
    relations.forEach((r) => {
      const fromT = tableMap[r.fromTable];
      const toT = tableMap[r.toTable];
      if (!fromT || !toT) return;
      const fromColIdx = fromT.columns.findIndex((c) => c.name === r.fromCol);
      const toColIdx = toT.columns.findIndex((c) => c.name === r.toCol);
      const fromY = fromT.y + 40 + fromColIdx * 28 + 14;
      const toY = toT.y + 40 + toColIdx * 28 + 14;
      let fromX, toX, c1x, c2x;
      const dist = Math.abs(toT.x - fromT.x);
      const offset = Math.max(50, dist * 0.4);
      if (fromT.x < toT.x) {
        fromX = fromT.x + fromT.width;
        toX = toT.x;
        c1x = fromX + offset;
        c2x = toX - offset;
      } else if (fromT.x > toT.x) {
        fromX = fromT.x;
        toX = toT.x + toT.width;
        c1x = fromX - offset;
        c2x = toX + offset;
      } else {
        fromX = fromT.x + fromT.width;
        toX = toT.x + toT.width;
        c1x = fromX + offset;
        c2x = toX + offset;
      }
      svg += `<path d="M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}" 
                    fill="none" stroke="var(--text-faint)" stroke-width="1.5" marker-end="url(#arrowhead)" />`;
      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;
      svg += `<rect x="${midX - 12}" y="${midY - 10}" width="24" height="14" rx="3" fill="var(--background-primary)" />`;
      svg += `<text x="${midX}" y="${midY}" fill="var(--text-faint)" font-size="11" text-anchor="middle" font-family="monospace">${this.escapeXml(r.type)}</text>`;
    });
    return svg;
  }
  renderERD(el, tables, relations, tableMap, bounds, title) {
    const container = el.createDiv({ cls: "dbml-erd-container" });
    container.style.overflow = "hidden";
    container.style.maxHeight = "600px";
    container.style.border = "1px solid var(--background-modifier-border)";
    container.style.borderRadius = "6px";
    container.style.backgroundColor = "var(--background-primary)";
    container.style.position = "relative";
    const headerBar = container.createDiv();
    headerBar.style.position = "sticky";
    headerBar.style.top = "0";
    headerBar.style.zIndex = "10";
    headerBar.style.display = "flex";
    headerBar.style.justifyContent = "space-between";
    headerBar.style.alignItems = "center";
    headerBar.style.padding = "8px";
    headerBar.style.background = "var(--background-primary)";
    headerBar.style.borderBottom =
      "1px solid var(--background-modifier-border)";
    const leftRegion = headerBar.createDiv();
    leftRegion.style.flex = "1 1 0%";
    leftRegion.style.display = "flex";
    leftRegion.style.alignItems = "center";
    if (title) {
      leftRegion.createEl("span", {
        text: this.escapeXml(title),
      }).style.cssText =
        "font-size: 14px; font-weight: 700; color: var(--text-accent-on-background, var(--text-normal)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
    }
    const centerRegion = headerBar.createDiv();
    centerRegion.style.flex = "0 1 auto";
    centerRegion.style.display = "flex";
    centerRegion.style.justifyContent = "center";
    centerRegion.style.alignItems = "center";
    const rightRegion = headerBar.createDiv();
    rightRegion.style.flex = "1 1 0%";
    rightRegion.style.display = "flex";
    rightRegion.style.justifyContent = "flex-end";
    rightRegion.style.alignItems = "center";
    rightRegion.style.gap = "8px";
    const zoomHint = rightRegion.createDiv();
    zoomHint.style.display = "flex";
    zoomHint.style.alignItems = "center";
    zoomHint.style.marginRight = "8px";
    const leftHint = zoomHint.createEl("span", {
      text: "Drag empty space to pan",
    });
    leftHint.style.cssText =
      "font-size:12px; color:var(--text-muted); white-space:nowrap;";
    const pipe = zoomHint.createEl("span", { text: "|" });
    pipe.style.cssText =
      "font-size:12px; color:var(--text-faint); margin:0 8px;";
    const rightHint = zoomHint.createEl("span", {
      text: "Ctrl/\u2318+Scroll to zoom",
    });
    rightHint.style.cssText =
      "font-size:12px; color:var(--text-muted); white-space:nowrap;";
    const controlsGroup = rightRegion.createDiv();
    controlsGroup.style.display = "flex";
    controlsGroup.style.alignItems = "center";
    controlsGroup.style.gap = "6px";
    const btnStyle = (btn) => {
      btn.style.background = "transparent";
      btn.style.color = "var(--text-normal)";
      btn.style.border = "1px solid transparent";
      btn.style.borderRadius = "4px";
      btn.style.padding = "4px 8px";
      btn.style.cursor = "pointer";
      btn.style.fontWeight = "600";
    };
    const zoomOutBtn = controlsGroup.createEl("button", { text: "\u2212" });
    btnStyle(zoomOutBtn);
    const zoomLabel = controlsGroup.createEl("span", { text: "100%" });
    zoomLabel.style.minWidth = "40px";
    zoomLabel.style.textAlign = "center";
    zoomLabel.style.fontSize = "12px";
    zoomLabel.style.color = "var(--text-muted)";
    const zoomInBtn = controlsGroup.createEl("button", { text: "+" });
    btnStyle(zoomInBtn);
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}" style="user-select: none;">`;
    svgContent += `
        <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-faint)" />
            </marker>
        </defs>`;
    svgContent += `<g id="dbml-paths">${this.generateRelationsSVG(relations, tableMap)}</g>`;
    svgContent += `<g id="dbml-tables">`;
    tables.forEach((t) => {
      svgContent += `<g data-table-name="${t.name}" transform="translate(${t.x}, ${t.y})" style="cursor: grab;">`;
      svgContent += `<rect x="3" y="3" width="${t.width}" height="${t.height}" fill="rgba(0,0,0,0.15)" rx="6"/>`;
      const strokeDash = t.isGhost ? "stroke-dasharray='5,5'" : "";
      svgContent += `<rect width="${t.width}" height="${t.height}" fill="var(--background-secondary)" fill-opacity="0.70" stroke="var(--background-modifier-border)" rx="6" ${strokeDash}/>`;
      svgContent += `<path d="M0,6 Q0,0 6,0 L${t.width - 6},0 Q${t.width},0 ${t.width},6 L${t.width},40 L0,40 Z" fill="var(--interactive-accent)" />`;
      const titleText = t.isGhost ? `${t.name} (ref)` : t.name;
      svgContent += `<text x="12" y="26" fill="var(--text-on-accent)" font-weight="bold" font-size="14" font-family="var(--font-monospace)">${this.escapeXml(titleText)}</text>`;
      t.columns.forEach((c, i) => {
        const cy = 40 + i * 28 + 19;
        const displayName = c.pk ? `PK ${c.name}` : c.name;
        const weight = c.pk ? 'font-weight="bold"' : "";
        svgContent += `<text x="12" y="${cy}" fill="var(--text-normal)" font-size="13" ${weight} font-family="var(--font-monospace)">${this.escapeXml(displayName)}</text>`;
        svgContent += `<text x="${t.width - 12}" y="${cy}" fill="var(--text-faint)" font-size="12" text-anchor="end" font-family="var(--font-monospace)">${this.escapeXml(c.type)}</text>`;
      });
      svgContent += `</g>`;
    });
    svgContent += `</g></svg>`;
    container.insertAdjacentHTML("beforeend", svgContent);
    const svgEl = container.querySelector("svg");
    const pathsGroup = container.querySelector("#dbml-paths");
    const tableElements = container.querySelectorAll("g[data-table-name]");
    let currentZoom = 1;
    let panX = 0;
    let panY = 0;
    let currentBounds = { width: bounds.width, height: bounds.height };
    const updateSvgBounds = () => {
      let minX = 0;
      let minY = 0;
      let maxRight = bounds.width;
      let maxBottom = bounds.height;
      Object.keys(tableMap).forEach((key) => {
        const t = tableMap[key];
        minX = Math.min(minX, t.x);
        minY = Math.min(minY, t.y);
        maxRight = Math.max(maxRight, t.x + t.width);
        maxBottom = Math.max(maxBottom, t.y + t.height);
      });
      const padding = 80;
      const viewX = minX - padding / 2;
      const viewY = minY - padding / 2;
      const viewWidth = maxRight - minX + padding;
      const viewHeight = maxBottom - minY + padding;
      currentBounds.width = viewWidth;
      currentBounds.height = viewHeight;
      svgEl.setAttribute("width", `${currentBounds.width}`);
      svgEl.setAttribute("height", `${currentBounds.height}`);
      svgEl.setAttribute(
        "viewBox",
        `${viewX} ${viewY} ${viewWidth} ${viewHeight}`,
      );
    };
    const applyZoom = () => {
      svgEl.style.width = `${currentBounds.width * currentZoom}px`;
      svgEl.style.height = `${currentBounds.height * currentZoom}px`;
      svgEl.style.transform = `translate(${panX}px, ${panY}px)`;
      svgEl.style.transformOrigin = "0 0";
      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
    };
    updateSvgBounds();
    applyZoom();
    container.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        if (e.deltaY < 0) currentZoom = Math.min(3, currentZoom * 1.07);
        else currentZoom = Math.max(0.2, currentZoom / 1.07);
        applyZoom();
      },
      { passive: false },
    );
    zoomInBtn.addEventListener("click", () => {
      currentZoom = Math.min(3, currentZoom + 0.1);
      applyZoom();
    });
    zoomOutBtn.addEventListener("click", () => {
      currentZoom = Math.max(0.2, currentZoom - 0.1);
      applyZoom();
    });
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartPanX = 0;
    let panStartPanY = 0;
    svgEl.addEventListener("mousedown", (e) => {
      const target = e.target;
      if (target.getAttribute("data-table-name")) return;
      if (target.closest("g[data-table-name]")) return;
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartPanX = panX;
      panStartPanY = panY;
      svgEl.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      panX = panStartPanX + dx / currentZoom;
      panY = panStartPanY + dy / currentZoom;
      applyZoom();
    });
    window.addEventListener("mouseup", () => {
      if (isPanning) {
        isPanning = false;
        svgEl.style.cursor = "grab";
      }
    });
    tableElements.forEach((gEl) => {
      gEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const name = gEl.getAttribute("data-table-name");
        const dragTarget = tableMap[name];
        const startTableX = dragTarget.x;
        const startTableY = dragTarget.y;
        const rect = svgEl.getBoundingClientRect();
        const startSvgX = (e.clientX - rect.left - panX) / currentZoom;
        const startSvgY = (e.clientY - rect.top - panY) / currentZoom;
        gEl.style.cursor = "grabbing";
        gEl.parentNode.appendChild(gEl);
        const onMouseMove = (ev) => {
          const r = svgEl.getBoundingClientRect();
          const curSvgX = (ev.clientX - r.left - panX) / currentZoom;
          const curSvgY = (ev.clientY - r.top - panY) / currentZoom;
          const dx = curSvgX - startSvgX;
          const dy = curSvgY - startSvgY;
          dragTarget.x = startTableX + dx;
          dragTarget.y = startTableY + dy;
          gEl.setAttribute(
            "transform",
            `translate(${dragTarget.x}, ${dragTarget.y})`,
          );
          updateSvgBounds();
          applyZoom();
          pathsGroup.innerHTML = this.generateRelationsSVG(relations, tableMap);
        };
        const onMouseUp = () => {
          gEl.style.cursor = "grab";
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      });
    });
  }
};
