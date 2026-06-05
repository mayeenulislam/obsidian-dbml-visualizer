import { Plugin, TFile, MarkdownPostProcessorContext } from "obsidian";

interface Column {
  name: string;
  type: string;
  pk: boolean;
}

interface Table {
  name: string;
  columns: Column[];
  x: number;
  y: number;
  width: number;
  height: number;
  isGhost?: boolean;
}

interface Relation {
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
  type: string;
}

export default class DBMLVisualizerPlugin extends Plugin {
  async onload() {
    const processor = async (
      source: string,
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
    ) => {
      try {
        // If the code block is empty (only whitespace/newlines), don't render a diagram
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
          title ?? undefined,
        );
      } catch (e: unknown) {
        el.createEl("pre", {
          text:
            "Error parsing DBML:\n" +
            (e instanceof Error ? e.message : String(e)),
        });
      }
    };

    // Register both lowercase and uppercase to guarantee matching regardless of internal normalization
    this.registerMarkdownCodeBlockProcessor("dbml", processor);
    this.registerMarkdownCodeBlockProcessor("DBML", processor);
  }

  async extractCodeBlockTitle(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    const text = await this.app.vault.read(file);
    const lines = text.split(/\r?\n/);

    const parseFenceMeta = (infoString: string) => {
      const trimmed = infoString.trim();
      if (!trimmed.toLowerCase().startsWith("dbml")) {
        return null;
      }
      const titleMatch =
        trimmed.match(/title\s*=\s*"([^"]+)"/i) ??
        trimmed.match(/title\s*=\s*'([^']+)'/i);
      if (!titleMatch) {
        return null;
      }
      const title = titleMatch[1].trim();
      return title.length ? title : null;
    };

    const sectionInfo = ctx.getSectionInfo(el);
    if (sectionInfo) {
      let lineIndex = sectionInfo.lineStart;

      // Check if the current line is the opening fence
      if (lineIndex >= 0 && lines[lineIndex].trim().startsWith("```")) {
        const infoString = lines[lineIndex].trim().slice(3).trim();
        const title = parseFenceMeta(infoString);
        if (title) return title;
      }

      // If not, check the line right before the start (which should be the opening fence)
      if (lineIndex - 1 >= 0 && lines[lineIndex - 1].trim().startsWith("```")) {
        const infoString = lines[lineIndex - 1].trim().slice(3).trim();
        const title = parseFenceMeta(infoString);
        if (title) return title;
      }
    }

    // Fallback: Find the first line of source in the text, and look backwards for the fence
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
      // Handle empty code block
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

  parseDBML(source: string) {
    const tables: Table[] = [];
    const relations: Relation[] = [];
    const tableMap: Record<string, boolean> = {};

    const tableRegex = /(\w+)\s*\{([\s\S]*?)\}/g;
    let match;

    while ((match = tableRegex.exec(source)) !== null) {
      const name = match[1];
      const colsStr = match[2];
      const columns: Column[] = [];

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
        fromTable: fromTable,
        fromCol: match[2],
        type: match[3],
        toTable: toTable,
        toCol: match[5],
      });

      const createGhost = (tblName: string, colName: string) => {
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

  layoutTables(tables: Table[], relations: Relation[]) {
    const tableMap: Record<string, Table> = {};
    tables.forEach((t) => (tableMap[t.name] = t));

    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
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

    const layers: string[][] = [];
    const visited = new Set<string>();

    while (visited.size < tables.length) {
      let queue = tables
        .filter((t) => inDegree[t.name] === 0 && !visited.has(t.name))
        .map((t) => t.name);

      if (queue.length === 0 && tables.length > 0) {
        let minDeg = Infinity;
        let candidates: string[] = [];
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
        const nextQueue: string[] = [];

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

    while (resolveOverlaps()) {
      // repeat until no collision remains
    }

    tables.forEach((t) => {
      maxRight = Math.max(maxRight, t.x + t.width);
      maxBottom = Math.max(maxBottom, t.y + t.height);
    });

    return {
      tableMap,
      bounds: { width: maxRight + 80, height: maxBottom + 80 },
    };
  }

  escapeXml(unsafe: string) {
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

  appendRelationElements(
    parent: Element,
    relations: Relation[],
    tableMap: Record<string, Table>,
  ) {
    const ns = "http://www.w3.org/2000/svg";
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

      const path = document.createElementNS(ns, "path");
      path.setAttribute(
        "d",
        `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}`,
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--text-faint)");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("marker-end", "url(#arrowhead)");
      parent.appendChild(path);

      const midX = (fromX + toX) / 2;
      const midY = (fromY + toY) / 2;

      const labelBg = document.createElementNS(ns, "rect");
      labelBg.setAttribute("x", `${midX - 12}`);
      labelBg.setAttribute("y", `${midY - 10}`);
      labelBg.setAttribute("width", "24");
      labelBg.setAttribute("height", "14");
      labelBg.setAttribute("rx", "3");
      labelBg.setAttribute("fill", "var(--background-primary)");
      parent.appendChild(labelBg);

      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", `${midX}`);
      label.setAttribute("y", `${midY}`);
      label.setAttribute("fill", "var(--text-faint)");
      label.setAttribute("font-size", "11");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-family", "monospace");
      label.textContent = r.type;
      parent.appendChild(label);
    });
  }

  renderERD(
    el: HTMLElement,
    tables: Table[],
    relations: Relation[],
    tableMap: Record<string, Table>,
    bounds: { width: number; height: number },
    title?: string,
  ) {
    const container = el.createDiv({ cls: "dbml-erd-container" });

    const headerBar = container.createDiv({ cls: "dbml-erd-header" });

    // 1. Left Region (Title goes here if provided)
    const leftRegion = headerBar.createDiv({ cls: "dbml-erd-header-left" });

    if (title) {
      leftRegion.createEl("span", {
        text: this.escapeXml(title),
        cls: "dbml-erd-title",
      });
    }

    // 2. Center Region (Empty, maintains layout structure)
    const centerRegion = headerBar.createDiv({ cls: "dbml-erd-header-center" });

    // 3. Right Region (Controls)
    const rightRegion = headerBar.createDiv({ cls: "dbml-erd-header-right" });

    const zoomHint = rightRegion.createDiv({ cls: "dbml-erd-zoom-hint" });

    const leftHint = zoomHint.createEl("span", {
      text: "Drag empty space to pan",
      cls: "dbml-erd-hint-text",
    });

    const pipe = zoomHint.createEl("span", {
      text: "|",
      cls: "dbml-erd-hint-pipe",
    });

    const rightHint = zoomHint.createEl("span", {
      text: "Ctrl/⌘+Scroll to zoom",
      cls: "dbml-erd-hint-text",
    });

    const controlsGroup = rightRegion.createDiv({ cls: "dbml-erd-controls" });

    const zoomOutBtn = controlsGroup.createEl("button", {
      text: "−",
      cls: "dbml-erd-btn",
    });
    const zoomLabel = controlsGroup.createEl("span", {
      text: "100%",
      cls: "dbml-erd-zoom-label",
    });
    const zoomInBtn = controlsGroup.createEl("button", {
      text: "+",
      cls: "dbml-erd-btn",
    });

    // SVG Creation
    const ns = "http://www.w3.org/2000/svg";
    const svgEl = document.createElementNS(
      ns,
      "svg",
    ) as unknown as SVGSVGElement;
    svgEl.classList.add("dbml-erd-svg");
    svgEl.setAttribute("width", `${bounds.width}`);
    svgEl.setAttribute("height", `${bounds.height}`);
    svgEl.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);

    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto");
    const polygon = document.createElementNS(ns, "polygon");
    polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
    polygon.setAttribute("fill", "var(--text-faint)");
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svgEl.appendChild(defs);

    const pathsGroup = document.createElementNS(
      ns,
      "g",
    ) as unknown as SVGGElement;
    pathsGroup.setAttribute("id", "dbml-paths");
    svgEl.appendChild(pathsGroup);

    const tablesGroup = document.createElementNS(
      ns,
      "g",
    ) as unknown as SVGGElement;
    tablesGroup.setAttribute("id", "dbml-tables");
    svgEl.appendChild(tablesGroup);

    tables.forEach((t) => {
      const g = document.createElementNS(ns, "g");
      g.setAttribute("data-table-name", t.name);
      g.setAttribute("transform", `translate(${t.x}, ${t.y})`);

      const shadow = document.createElementNS(ns, "rect");
      shadow.setAttribute("x", "3");
      shadow.setAttribute("y", "3");
      shadow.setAttribute("width", `${t.width}`);
      shadow.setAttribute("height", `${t.height}`);
      shadow.setAttribute("fill", "rgba(0,0,0,0.15)");
      shadow.setAttribute("rx", "6");
      g.appendChild(shadow);

      const bg = document.createElementNS(ns, "rect");
      bg.setAttribute("width", `${t.width}`);
      bg.setAttribute("height", `${t.height}`);
      bg.setAttribute("fill", "var(--background-secondary)");
      bg.setAttribute("fill-opacity", "0.70");
      bg.setAttribute("stroke", "var(--background-modifier-border)");
      bg.setAttribute("rx", "6");
      if (t.isGhost) {
        bg.setAttribute("stroke-dasharray", "5,5");
      }
      g.appendChild(bg);

      const header = document.createElementNS(ns, "path");
      header.setAttribute(
        "d",
        `M0,6 Q0,0 6,0 L${t.width - 6},0 Q${t.width},0 ${t.width},6 L${t.width},40 L0,40 Z`,
      );
      header.setAttribute("fill", "var(--interactive-accent)");
      g.appendChild(header);

      const titleText = t.isGhost ? `${t.name} (ref)` : t.name;
      const title = document.createElementNS(ns, "text");
      title.setAttribute("x", "12");
      title.setAttribute("y", "26");
      title.setAttribute("fill", "var(--text-on-accent)");
      title.setAttribute("font-weight", "bold");
      title.setAttribute("font-size", "14");
      title.setAttribute("font-family", "var(--font-monospace)");
      title.textContent = this.escapeXml(titleText);
      g.appendChild(title);

      t.columns.forEach((c, i) => {
        const cy = 40 + i * 28 + 19;
        const displayName = c.pk ? `PK ${c.name}` : c.name;

        const colName = document.createElementNS(ns, "text");
        colName.setAttribute("x", "12");
        colName.setAttribute("y", `${cy}`);
        colName.setAttribute("fill", "var(--text-normal)");
        colName.setAttribute("font-size", "13");
        colName.setAttribute("font-family", "var(--font-monospace)");
        if (c.pk) {
          colName.setAttribute("font-weight", "bold");
        }
        colName.textContent = this.escapeXml(displayName);
        g.appendChild(colName);

        const colType = document.createElementNS(ns, "text");
        colType.setAttribute("x", `${t.width - 12}`);
        colType.setAttribute("y", `${cy}`);
        colType.setAttribute("fill", "var(--text-faint)");
        colType.setAttribute("font-size", "12");
        colType.setAttribute("text-anchor", "end");
        colType.setAttribute("font-family", "var(--font-monospace)");
        colType.textContent = this.escapeXml(c.type);
        g.appendChild(colType);
      });

      tablesGroup.appendChild(g);
    });

    this.appendRelationElements(pathsGroup, relations, tableMap);

    container.appendChild(svgEl);

    const tableElements = container.querySelectorAll("g[data-table-name]");

    let currentZoom = 1;
    let panX = 0;
    let panY = 0;
    let currentBounds = { width: bounds.width, height: bounds.height };

    const updateSvgBounds = () => {
      // Calculate bounding box including negative positions so left/top panning works
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

      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
    };

    updateSvgBounds();
    applyZoom();

    // Scroll zoom (ctrl/cmd + wheel only)
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

    // Button zoom
    zoomInBtn.addEventListener("click", () => {
      currentZoom = Math.min(3, currentZoom + 0.1);
      applyZoom();
    });
    zoomOutBtn.addEventListener("click", () => {
      currentZoom = Math.max(0.2, currentZoom - 0.1);
      applyZoom();
    });

    // Pan/Drag Canvas Logic
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartPanX = 0;
    let panStartPanY = 0;

    svgEl.addEventListener("mousedown", (e: MouseEvent) => {
      // Only pan if clicking on empty space (not on a table)
      const target = e.target as SVGElement;
      if (target.getAttribute("data-table-name")) return;
      if (target.closest("g[data-table-name]")) return;

      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartPanX = panX;
      panStartPanY = panY;
      svgEl.classList.add("is-panning");
    });

    window.addEventListener("mousemove", (e: MouseEvent) => {
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
        svgEl.classList.remove("is-panning");
      }
    });

    // Drag & Drop Logic
    tableElements.forEach((gEl) => {
      (gEl as SVGElement).addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const name = (gEl as SVGElement).getAttribute("data-table-name")!;
        const dragTarget = tableMap[name];

        const startTableX = dragTarget.x;
        const startTableY = dragTarget.y;

        const rect = svgEl.getBoundingClientRect();
        const startSvgX = (e.clientX - rect.left - panX) / currentZoom;
        const startSvgY = (e.clientY - rect.top - panY) / currentZoom;

        (gEl as SVGElement).classList.add("is-dragging");

        // Bring to front
        (gEl.parentNode as SVGElement).appendChild(gEl);

        const onMouseMove = (ev: MouseEvent) => {
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

          // Redraw paths
          while (pathsGroup.firstChild) pathsGroup.firstChild.remove();
          this.appendRelationElements(pathsGroup, relations, tableMap);
        };

        const onMouseUp = () => {
          (gEl as SVGElement).classList.remove("is-dragging");
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      });
    });
  }
}
