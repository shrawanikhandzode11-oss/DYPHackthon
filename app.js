let currentFilter = "all";
let searchQuery = "";
let data = { nodes: [] };
let graphState = null;

const API_BASE = localStorage.getItem("apiBase") || "http://127.0.0.1:5000";
const GITHUB_TOKEN_KEY = "githubToken";

function generateMockData(repoName) {
  const repoLower = (repoName || "").toLowerCase();
  const authors = ["A. Singh", "R. Patel", "K. Iyer", "M. Sharma", "S. Rao"];
  const commitMsgs = [
    "Refactor module boundaries",
    "Fix dependency wiring",
    "Add validation and edge-case handling",
    "Optimize startup flow",
    "Stabilize API contract",
    "Update tests after behavior change"
  ];
  const isoDaysAgo = days => new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
  const buildCommits = (id, name, risk) => {
    const idx = Number(id) || 0;
    const baseCount = risk >= 3 ? 5 : risk === 2 ? 3 : 2;
    const count = Math.max(1, Math.min(6, baseCount + (idx % 2)));
    return Array.from({ length: count }, (_, i) => ({
      message: `${commitMsgs[(idx + i) % commitMsgs.length]} · ${name}`,
      author: authors[(idx + i) % authors.length],
      date: isoDaysAgo((i + 1) * (idx % 3 + 1))
    }));
  };
  const mk = (id, name, type, risk, deps, summary) => {
    const commits = buildCommits(id, name, risk);
    const commitCount = commits.length;
    const stability = commitCount >= 5 ? "unstable" : commitCount >= 3 ? "watch" : "stable";
    const isUnstable = stability === "unstable";
    const evolutionSummary =
      isUnstable
        ? "This module has been modified frequently and may be unstable."
        : commitCount >= 3
          ? "This module shows active evolution and periodic refactoring."
          : "This module has low recent change frequency and appears stable.";

    return {
      id,
      name,
      type,
      risk,
      deps,
      summary,
      commits,
      lastModified: commits[0]?.date || null,
      lastAuthor: commits[0]?.author || "Unknown",
      commitCount,
      stability,
      evolutionSummary,
      isUnstable
    };
  };

  if (repoLower.includes("react")) {
    return {
      nodes: [
        mk("0", "App.jsx", "entry", 2, ["1", "2", "4"], "Main React application component and entry point."),
        mk("1", "hooks.js", "util", 1, [], "Reusable custom hooks for React components."),
        mk("2", "AuthContext.js", "service", 3, ["3"], "Authentication context for user sessions and tokens."),
        mk("3", "authService.js", "service", 3, [], "Auth service handling login and token refresh flows."),
        mk("4", "Router.jsx", "entry", 2, ["5", "6"], "Application router for navigation and protected routes."),
        mk("5", "api.js", "util", 2, [], "HTTP client utilities for backend requests."),
        mk("6", "Dashboard.jsx", "entry", 1, ["1"], "Dashboard page displaying analytics widgets."),
        mk("7", "Profile.jsx", "entry", 1, ["1"], "User profile page and settings."),
        mk("8", "constants.js", "config", 1, [], "App constants and configuration values."),
        mk("9", "App.test.js", "test", 1, ["0"], "Tests for the main application component.")
      ]
    };
  }

  return {
    nodes: [
      mk("0", "main.py", "entry", 2, ["1", "2"], "Main application entry point."),
      mk("1", "config.py", "config", 1, [], "Configuration and environment setup."),
      mk("2", "database.py", "service", 3, ["3"], "Database connection and ORM setup."),
      mk("3", "models.py", "service", 2, [], "Data model definitions."),
      mk("4", "api.py", "entry", 2, ["2"], "API routes and request handling."),
      mk("5", "utils.py", "util", 1, [], "Utility functions."),
      mk("6", "tests.py", "test", 1, ["0"], "Unit tests.")
    ]
  };
}

async function fetchAnalyzedData(repoUrl, githubToken = "") {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: repoUrl, githubToken })
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "Analysis failed");
  }
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.nodes)) throw new Error("Invalid response from analysis API");
  return payload;
}

function toRelativeTime(iso) {
  if (!iso) return "No date available";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Invalid date";
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function formatDate(iso) {
  if (!iso) return "No date available";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Invalid date";
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch {
    return "Invalid date";
  }
}

function detectRole(node) {
  const n = (node.name || "").toLowerCase();
  if (n.includes("auth")) return "Authentication";
  if (n.includes("api") || n.includes("route") || n.includes("controller")) return "API flow";
  if (n.includes("db") || n.includes("database") || n.includes("model")) return "Data layer";
  if (node.type === "entry") return "Entry orchestration";
  if (node.type === "config") return "Configuration";
  if (node.type === "test") return "Quality assurance";
  return "Core module";
}

function enrichData(payload) {
  const nodes = (payload.nodes || []).map(node => ({
    ...node,
    deps: Array.isArray(node.deps) ? node.deps : [],
    commits: Array.isArray(node.commits) ? node.commits : [],
    commitCount: typeof node.commitCount === "number" ? node.commitCount : (Array.isArray(node.commits) ? node.commits.length : 0),
    stability: node.stability || "stable",
    lastModified: node.lastModified || (node.commits?.[0]?.date || null),
    lastAuthor: node.lastAuthor || (node.commits?.[0]?.author || "Unknown"),
    role: detectRole(node)
  }));

  const incoming = new Map(nodes.map(n => [n.id, 0]));
  nodes.forEach(n => n.deps.forEach(d => incoming.set(d, (incoming.get(d) || 0) + 1)));

  nodes.forEach(n => {
    n.incomingDeps = typeof n.incomingDeps === "number" ? n.incomingDeps : (incoming.get(n.id) || 0);
    n.outgoingDeps = typeof n.outgoingDeps === "number" ? n.outgoingDeps : n.deps.length;
    n.isOrphan = typeof n.isOrphan === "boolean" ? n.isOrphan : (n.incomingDeps === 0 && n.outgoingDeps === 0);
    n.isUnstable = typeof n.isUnstable === "boolean" ? n.isUnstable : (n.commitCount >= 5 || n.stability === "unstable");
    n.isNewModule = typeof n.isNewModule === "boolean" ? n.isNewModule : (n.commitCount <= 2 && toRelativeTime(n.lastModified).includes("day"));
    n.isRefactoredOften = typeof n.isRefactoredOften === "boolean" ? n.isRefactoredOften : n.commitCount >= 4;
    n.evolutionSummary = n.evolutionSummary || (n.isUnstable ? "This module has frequent updates and may be unstable." : "This module appears comparatively stable.");
  });

  return { ...payload, nodes };
}

function updateFilterButtons() {
  document.querySelectorAll("#filters li").forEach(li => li.classList.toggle("active", li.dataset.type === currentFilter));
}

function updateStats() {
  document.getElementById("files").innerText = data.nodes.length;
  document.getElementById("deps").innerText = data.nodes.reduce((sum, node) => sum + node.deps.length, 0);
  document.getElementById("risk").innerText = data.nodes.filter(node => node.risk >= 3).length;
  document.getElementById("entries").innerText = data.nodes.filter(node => node.type === "entry").length;
}

function loadOnboarding() {
  const list = document.getElementById("onboarding");
  list.innerHTML = "";
  [...data.nodes]
    .sort((a, b) => (b.risk + b.commitCount) - (a.risk + a.commitCount))
    .slice(0, 10)
    .forEach((node, index) => {
      const li = document.createElement("li");
      li.textContent = `${index + 1}. ${node.name}`;
      list.appendChild(li);
    });
}

function updateInsights() {
  const incoming = new Map(data.nodes.map(n => [n.id, 0]));
  data.nodes.forEach(node => node.deps.forEach(dep => incoming.set(dep, (incoming.get(dep) || 0) + 1)));

  const mostConnected = [...data.nodes].sort((a, b) => ((incoming.get(b.id) || 0) + b.deps.length) - ((incoming.get(a.id) || 0) + a.deps.length)).slice(0, 5);
  const highRisk = data.nodes.filter(node => node.risk >= 3).slice(0, 5);
  const unused = data.nodes.filter(node => node.isOrphan || (node.deps.length === 0 && (incoming.get(node.id) || 0) === 0));
  
  // NEW: Dependency insights
  const highlyCoupled = data.nodes.filter(node => {
    const totalDeps = (node.incomingDeps || 0) + (node.outgoingDeps || 0);
    return totalDeps > 10;
  }).slice(0, 5);
  
  const criticalNodes = data.nodes.filter(node => {
    return (node.incomingDeps || 0) >= 5 && node.risk >= 2;
  }).slice(0, 5);
  
  const unstableFiles = data.nodes.filter(node => node.isUnstable || node.stability === "unstable").slice(0, 5);

  const fill = (id, items, mapper, fallback) => {
    const container = document.getElementById(id);
    container.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.innerText = fallback;
      container.appendChild(li);
      return;
    }
    items.forEach(item => {
      const li = document.createElement("li");
      li.innerHTML = mapper(item);
      container.appendChild(li);
    });
  };

  fill("mostConnected", mostConnected, item => {
    const total = (incoming.get(item.id) || 0) + item.deps.length;
    const couplingLevel = total > 10 ? "🔴" : total > 5 ? "🟡" : "🟢";
    return `${item.name} <span style="float:right;color:#0f172a;opacity:0.75">${couplingLevel} ${total}</span>`;
  }, "No connected files");
  
  fill("highRisk", highRisk, item => {
    const totalDeps = (item.incomingDeps || 0) + (item.outgoingDeps || 0);
    return `${item.name} <span style="float:right;color:#ef4444;opacity:0.9">Risk ${item.risk} (${totalDeps} deps)</span>`;
  }, "No high-risk files");
  
  fill("unusedFiles", unused, item => {
    const reason = item.isOrphan ? "orphan" : "no connections";
    return `${item.name} <span style="float:right;color:#f59e0b;opacity:0.7;font-size:11px">${reason}</span>`;
  }, "No unused files found");
  
  // Add new insight sections if they don't exist
  if (!document.getElementById("highlyCoupled")) {
    const insightsContainer = document.getElementById("insights");
    
    // Add Highly Coupled section
    const highlyCoupledCard = document.createElement("div");
    highlyCoupledCard.className = "insight-card";
    highlyCoupledCard.innerHTML = `
      <h4>Highly Coupled</h4>
      <ul id="highlyCoupled"></ul>
    `;
    insightsContainer.appendChild(highlyCoupledCard);
    
    // Add Critical Nodes section
    const criticalNodesCard = document.createElement("div");
    criticalNodesCard.className = "insight-card";
    criticalNodesCard.innerHTML = `
      <h4>Critical Nodes</h4>
      <ul id="criticalNodes"></ul>
    `;
    insightsContainer.appendChild(criticalNodesCard);
    
    // Add Unstable Files section
    const unstableFilesCard = document.createElement("div");
    unstableFilesCard.className = "insight-card";
    unstableFilesCard.innerHTML = `
      <h4>Unstable Files</h4>
      <ul id="unstableFiles"></ul>
    `;
    insightsContainer.appendChild(unstableFilesCard);
  }
  
  // Fill new insight sections
  fill("highlyCoupled", highlyCoupled, item => {
    const totalDeps = (item.incomingDeps || 0) + (item.outgoingDeps || 0);
    const riskColor = item.risk >= 3 ? '#ef4444' : item.risk >= 2 ? '#f59e0b' : '#22c55e';
    return `${item.name} <span style="float:right;color:${riskColor};opacity:0.9">${totalDeps} deps</span>`;
  }, "No highly coupled files");
  
  fill("criticalNodes", criticalNodes, item => {
    const impact = (item.incomingDeps || 0);
    return `${item.name} <span style="float:right;color:#dc2626;opacity:0.9">affects ${impact} files</span>`;
  }, "No critical nodes found");
  
  fill("unstableFiles", unstableFiles, item => {
    const commits = item.commitCount || 0;
    return `${item.name} <span style="float:right;color:#f59e0b;opacity:0.9">${commits} commits</span>`;
  }, "No unstable files");
  
  // Add dependency statistics summary
  const totalDeps = data.nodes.reduce((sum, node) => sum + (node.incomingDeps || 0) + (node.outgoingDeps || 0), 0);
  const avgDeps = (totalDeps / data.nodes.length).toFixed(1);
  const maxDeps = Math.max(...data.nodes.map(node => (node.incomingDeps || 0) + (node.outgoingDeps || 0)));
  
  // Update or create stats summary
  let statsSummary = document.getElementById("dependencyStats");
  if (!statsSummary) {
    statsSummary = document.createElement("div");
    statsSummary.id = "dependencyStats";
    statsSummary.className = "insight-card";
    statsSummary.innerHTML = `
      <h4>Dependency Statistics</h4>
      <div id="statsContent"></div>
    `;
    document.getElementById("insights").insertBefore(statsSummary, document.getElementById("insights").firstChild);
  }
  
  document.getElementById("statsContent").innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span>Total Dependencies:</span>
      <span style="font-weight: bold; color: #0066ff;">${totalDeps}</span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span>Average per File:</span>
      <span style="font-weight: bold; color: #22c55e;">${avgDeps}</span>
    </div>
    <div style="display: flex; justify-content: space-between;">
      <span>Max Dependencies:</span>
      <span style="font-weight: bold; color: #ef4444;">${maxDeps}</span>
    </div>
  `;
}

function getName(id) {
  const node = data.nodes.find(n => n.id === id);
  return node ? node.name : `Unknown (${id})`;
}

function getDependents(nodeId) {
  return data.nodes.filter(n => n.deps.includes(nodeId));
}

function getDownstreamImpact(startId) {
  const impacted = new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    const dependents = getDependents(current);
    dependents.forEach(dep => {
      if (!impacted.has(dep.id)) {
        impacted.add(dep.id);
        queue.push(dep.id);
      }
    });
  }
  impacted.delete(startId);
  return [...impacted];
}

function stabilityBadge(node) {
  if (node.stability === "unstable" || node.isUnstable) return `<span style="color:#ef4444;font-weight:700">Unstable</span>`;
  if (node.stability === "watch") return `<span style="color:#f59e0b;font-weight:700">Watch</span>`;
  return `<span style="color:#16a34a;font-weight:700">Stable</span>`;
}

function selectNode(node) {
  const commits = (node.commits || []).slice(0, 5);
  const impactedIds = getDownstreamImpact(node.id);
  const impacted = impactedIds.map(getName);
  const depsList = node.deps.length ? node.deps.map(dep => `<li>${getName(dep)}</li>`).join("") : "<li>None</li>";
  const commitList = commits.length
    ? commits.map(c => `<li><strong>${c.author || "No author"}</strong> · ${formatDate(c.date)} (${toRelativeTime(c.date)})<br/>${c.message || "No commit message"}</li>`).join("")
    : "<li>No commit history available</li>";
  const impactedList = impacted.length ? impacted.map(name => `<li>${name}</li>`).join("") : "<li>No downstream modules detected</li>";
  
  // Calculate dependency insights
  const totalDeps = (node.incomingDeps || 0) + (node.outgoingDeps || 0);
  const couplingLevel = totalDeps > 10 ? "Highly Coupled" : totalDeps > 5 ? "Moderately Coupled" : "Loosely Coupled";
  const riskColor = node.risk >= 3 ? "#ef4444" : node.risk >= 2 ? "#f59e0b" : "#22c55e";

  document.getElementById("details").innerHTML = `
    <h3>${node.name}</h3>
    <p><strong>Role:</strong> ${node.role}</p>
    <p><strong>Type:</strong> ${node.type}</p>
    <p><strong>Risk:</strong> <span style="color: ${riskColor}; font-weight: bold;">${node.risk >= 3 ? "🔴 High" : "🟡 Medium"}</span></p>
    <p><strong>Stability:</strong> ${stabilityBadge(node)}</p>
    <p><strong>Coupling:</strong> <span style="color: ${totalDeps > 10 ? '#ef4444' : totalDeps > 5 ? '#f59e0b' : '#22c55e'}; font-weight: bold;">${couplingLevel}</span></p>
    <p><strong>Dependencies:</strong> ${node.outgoingDeps || 0} outgoing, ${node.incomingDeps || 0} incoming</p>
    <p><strong>Last modified:</strong> ${formatDate(node.lastModified)} by ${node.lastAuthor || "No author info"} (${toRelativeTime(node.lastModified)})</p>
    <p><strong>Evolution:</strong> ${node.evolutionSummary || "No evolution insight available."}</p>
    <p>${node.summary || "No summary available."}</p>
    
    <h4>Dependencies (${node.deps.length})</h4>
    <ul>${depsList}</ul>
    
    <h4>Dependents (${node.incomingDeps || 0})</h4>
    <ul>${impacted.length ? impacted.map(name => `<li>${name}</li>`).join("") : "<li>No dependents found</li>"}</ul>
    
    <h4>Commit Insights</h4>
    <ul>${commitList}</ul>
    
    <h4>Impact Analysis</h4>
    <p>If this file breaks, these modules are affected:</p>
    <ul>${impactedList}</ul>
    
    ${totalDeps > 10 ? `<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px; margin-top: 10px; border-radius: 4px;"><strong>⚠️ High Coupling Alert:</strong> This file has many dependencies and may be a bottleneck. Consider refactoring.</div>` : ''}
  `;

  // Highlight dependencies and dependents with different colors
  const allConnectedIds = new Set([node.id, ...node.deps, ...impactedIds]);
  applyGraphFocus(allConnectedIds, "impact");
  
  // Additional highlighting for dependencies vs dependents
  if (graphState) {
    const depsSet = new Set(node.deps);
    const dependentsSet = new Set(impactedIds);
    
    graphState.linkSel
      .transition().duration(300)
      .attr("stroke-opacity", d => {
        const s = typeof d.source === "object" ? d.source.id : d.source;
        const t = typeof d.target === "object" ? d.target.id : d.target;
        if ((s === node.id && depsSet.has(t)) || (t === node.id && dependentsSet.has(s))) {
          return 0.9;
        }
        return 0.3;
      })
      .attr("stroke", d => {
        const s = typeof d.source === "object" ? d.source.id : d.source;
        const t = typeof d.target === "object" ? d.target.id : d.target;
        if (s === node.id) return "#22c55e"; // Dependencies in green
        if (t === node.id) return "#ef4444"; // Dependents in red
        return "#9ca3af";
      })
      .attr("stroke-width", d => {
        const s = typeof d.source === "object" ? d.source.id : d.source;
        const t = typeof d.target === "object" ? d.target.id : d.target;
        if (s === node.id || t === node.id) return 3;
        return 1.4;
      });
  }
}

function getColor(node) {
  if (node.isOrphan) return "#f59e0b";
  if (node.type === "entry") return "#22c55e";
  if (node.type === "service") return "#ff6b35";
  if (node.type === "util") return "#00d4ff";
  if (node.type === "config") return "#7c3aed";
  if (node.type === "test") return "#06b6d4";
  return "#9ca3af";
}

function buildFilteredGraph() {
  const filteredNodes = data.nodes.filter(node => (currentFilter === "all" || node.type === currentFilter) && node.name.toLowerCase().includes(searchQuery));
  const byId = new Map(filteredNodes.map(n => [n.id, n]));
  const links = [];
  filteredNodes.forEach(node => node.deps.forEach(depId => { if (byId.has(depId)) links.push({ source: node.id, target: depId }); }));
  return { filteredNodes, links };
}

function renderGraph() {
  const container = document.getElementById("graph");
  const width = container.clientWidth;
  const height = container.clientHeight;
  container.innerHTML = "";
  d3.selectAll(".graph-tooltip").remove();

  const { filteredNodes, links } = buildFilteredGraph();
  if (!filteredNodes.length) {
    const empty = document.createElement("div");
    empty.className = "graph-empty";
    empty.innerText = "No files match the current filter";
    container.appendChild(empty);
    graphState = null;
    return;
  }

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height).style("background", "rgba(255,255,255,0.95)").style("border-radius", "20px");
  const graphGroup = svg.append("g");
  const zoom = d3.zoom().scaleExtent([0.45, 3]).on("zoom", event => graphGroup.attr("transform", event.transform));
  svg.call(zoom);

  // Create arrow markers for directed edges
  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 20)
    .attr("refY", 0)
    .attr("markerWidth", 8)
    .attr("markerHeight", 8)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#9ca3af")
    .attr("opacity", 0.6);

  const linkSel = graphGroup.selectAll(".link")
    .data(links)
    .enter()
    .append("line")
    .attr("class", "link")
    .attr("stroke", "#9ca3af")
    .attr("stroke-width", 1.4)
    .attr("stroke-opacity", 0.45)
    .attr("marker-end", "url(#arrowhead)")
    .style("transition", "all 0.3s ease");

  const nodeSel = graphGroup.selectAll(".node")
    .data(filteredNodes, d => d.id)
    .enter()
    .append("g")
    .attr("class", "node")
    .style("transition", "opacity 220ms ease");

  const simulation = d3.forceSimulation(filteredNodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(145))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(d => (d.risk >= 3 ? 34 : 28)))
    .alphaDecay(0.045);

  nodeSel.call(d3.drag()
    .on("start", event => {
      if (!event.active) simulation.alphaTarget(0.22).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    })
    .on("drag", event => {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    })
    .on("end", event => {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }));

  nodeSel.append("circle")
    .attr("r", d => (d.isOrphan ? 14 : d.risk >= 3 ? 22 : 18))
    .attr("fill", getColor)
    .attr("stroke", d => (d.isUnstable ? "#ef4444" : "#ffffff"))
    .attr("stroke-width", d => (d.isUnstable ? 3 : 2))
    .style("opacity", d => (d.isOrphan ? 0.65 : 1))
    .style("cursor", "pointer")
    .on("click", (event, d) => selectNode(d));

  nodeSel.append("text")
    .text(d => d.name)
    .attr("font-size", "12px")
    .attr("fill", "#0f172a")
    .attr("text-anchor", "middle")
    .attr("dy", 36)
    .attr("pointer-events", "none");

  const tooltip = d3.select("body").append("div")
    .attr("class", "graph-tooltip")
    .style("position", "absolute")
    .style("padding", "8px 12px")
    .style("background", "rgba(15, 23, 42, 0.9)")
    .style("color", "#fff")
    .style("border-radius", "10px")
    .style("font-size", "12px")
    .style("pointer-events", "none")
    .style("opacity", 0);

  nodeSel.on("mouseover", (event, d) => {
    // Highlight connected edges and nodes on hover
    const connectedNodeIds = new Set([d.id]);
    const connectedEdgeIds = new Set();
    
    // Find all connected edges and nodes
    links.forEach((link, i) => {
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      
      if (sourceId === d.id || targetId === d.id) {
        connectedEdgeIds.add(i);
        if (sourceId === d.id) connectedNodeIds.add(targetId);
        if (targetId === d.id) connectedNodeIds.add(sourceId);
      }
    });
    
    // Highlight edges
    linkSel
      .transition().duration(200)
      .attr("stroke-opacity", (linkData, i) => connectedEdgeIds.has(i) ? 0.9 : 0.15)
      .attr("stroke", (linkData, i) => connectedEdgeIds.has(i) ? "#0066ff" : "#9ca3af")
      .attr("stroke-width", (linkData, i) => connectedEdgeIds.has(i) ? 2.5 : 1.4);
    
    // Highlight nodes
    nodeSel
      .transition().duration(200)
      .style("opacity", nodeData => connectedNodeIds.has(nodeData.id) ? 1 : 0.4);
    
    const unstable = d.isUnstable ? " · unstable" : "";
    const orphan = d.isOrphan ? " · potentially unused" : "";
    const deps = d.deps ? d.deps.length : 0;
    const incoming = d.incomingDeps || 0;
    
    tooltip.html(`<strong>${d.name}</strong><br/><small>${d.type}${unstable}${orphan}</small><br/><small>Dependencies: ${deps} | Dependents: ${incoming}</small>`)
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY + 10}px`)
      .style("opacity", 1);
  }).on("mousemove", event => {
    tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY + 10}px`);
  }).on("mouseout", () => {
    tooltip.style("opacity", 0);
    // Reset highlights
    linkSel
      .transition().duration(200)
      .attr("stroke-opacity", 0.45)
      .attr("stroke", "#9ca3af")
      .attr("stroke-width", 1.4);
    nodeSel
      .transition().duration(200)
      .style("opacity", 1);
  });

  simulation.on("tick", () => {
    linkSel
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);
    nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  const nodeById = new Map(filteredNodes.map(n => [n.id, n]));
  const incoming = new Map(filteredNodes.map(n => [n.id, []]));
  filteredNodes.forEach(n => n.deps.forEach(d => { if (incoming.has(d)) incoming.get(d).push(n.id); }));

  graphState = { svg, zoom, simulation, nodeSel, linkSel, filteredNodes, links, nodeById, incoming };
  clearGraphFocus();
}

function edgeKey(sourceId, targetId) {
  return `${sourceId}->${targetId}`;
}

function applyGraphFocus(nodeIdSet, mode = "query") {
  if (!graphState) return;
  const ids = new Set(nodeIdSet);
  const edgeSet = new Set();
  
  graphState.links.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (ids.has(s) && ids.has(t)) edgeSet.add(edgeKey(s, t));
  });

  // Enhanced node highlighting with glow effect
  graphState.nodeSel.transition().duration(300)
    .style("opacity", d => (ids.has(d.id) ? 1 : 0.15))
    .style("filter", d => {
      if (ids.has(d.id)) {
        return "drop-shadow(0 0 8px rgba(0, 102, 255, 0.6))";
      }
      return "grayscale(0.8) brightness(0.7)";
    });

  // Enhanced edge highlighting with animated strokes
  graphState.linkSel.transition().duration(300)
    .attr("stroke-opacity", d => {
      const s = typeof d.source === "object" ? d.source.id : d.source;
      const t = typeof d.target === "object" ? d.target.id : d.target;
      return edgeSet.has(edgeKey(s, t)) ? 0.95 : 0.08;
    })
    .attr("stroke", d => {
      const s = typeof d.source === "object" ? d.source.id : d.source;
      const t = typeof d.target === "object" ? d.target.id : d.target;
      if (edgeSet.has(edgeKey(s, t))) {
        return mode === "impact" ? "#ef4444" : mode === "query" ? "#2563eb" : "#0066ff";
      }
      return "#9ca3af";
    })
    .attr("stroke-width", d => {
      const s = typeof d.source === "object" ? d.source.id : d.source;
      const t = typeof d.target === "object" ? d.target.id : d.target;
      return edgeSet.has(edgeKey(s, t)) ? 3 : 1;
    })
    .attr("stroke-dasharray", d => {
      const s = typeof d.source === "object" ? d.source.id : d.source;
      const t = typeof d.target === "object" ? d.target.id : d.target;
      return edgeSet.has(edgeKey(s, t)) ? "5, 5" : "none";
    });

  zoomToNodeSet(ids);
}

function clearGraphFocus() {
  if (!graphState) return;
  graphState.nodeSel.transition().duration(300).style("opacity", 1).style("filter", "none");
  graphState.linkSel.transition().duration(300)
    .attr("stroke-opacity", 0.45)
    .attr("stroke", "#9ca3af")
    .attr("stroke-width", 1.4)
    .attr("stroke-dasharray", "none");
}

function zoomToNodeSet(ids) {
  if (!graphState || !ids.size) return;
  const points = graphState.filteredNodes.filter(n => ids.has(n.id) && Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!points.length) return;

  const xs = points.map(n => n.x);
  const ys = points.map(n => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = document.getElementById("graph").clientWidth;
  const height = document.getElementById("graph").clientHeight;
  const boundsWidth = Math.max(maxX - minX, 1);
  const boundsHeight = Math.max(maxY - minY, 1);
  const scale = Math.max(0.55, Math.min(2.2, 0.8 / Math.max(boundsWidth / width, boundsHeight / height)));
  const tx = width / 2 - scale * ((minX + maxX) / 2);
  const ty = height / 2 - scale * ((minY + maxY) / 2);

  graphState.svg.transition().duration(450).call(graphState.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function setStatus(msg, state = "info") {
  const statusMsg = document.getElementById("statusMsg");
  statusMsg.innerText = msg;
  statusMsg.classList.remove("success", "error");
  if (state === "success") statusMsg.classList.add("success");
  if (state === "error") statusMsg.classList.add("error");
}

async function runAnalysis(repoUrl, githubToken = "") {
  setStatus("Analyzing repository architecture...");
  const payload = await fetchAnalyzedData(repoUrl, githubToken);
  data = enrichData(payload);
  setStatus("Live analysis complete.", "success");
  return "live";
}

function queryKeywords(query) {
  const q = query.toLowerCase();
  const map = {
    authentication: ["auth", "login", "token", "session", "jwt"],
    api: ["api", "route", "controller", "http", "request"],
    database: ["database", "db", "model", "orm", "sql", "mongo"],
    config: ["config", "env", "settings", "constant"],
    tests: ["test", "spec", "mock"],
    service: ["service", "provider", "handler"]
  };
  const terms = Object.values(map).flat();
  const matchedTerms = terms.filter(t => q.includes(t));
  if (!matchedTerms.length) return q.split(/\s+/).filter(Boolean);
  return matchedTerms;
}

function runNaturalLanguageQuery() {
  const raw = document.getElementById("nlQuery").value.trim();
  if (!raw) {
    document.getElementById("queryResult").innerText = "Enter a query to highlight files.";
    return;
  }
  if (!graphState) return;

  const terms = queryKeywords(raw);
  const matched = graphState.filteredNodes.filter(node => {
    const hay = `${node.name} ${node.type} ${node.summary || ""} ${node.role || ""}`.toLowerCase();
    return terms.some(t => hay.includes(t));
  });

  if (!matched.length) {
    document.getElementById("queryResult").innerText = "No matching modules found for that query in the current view.";
    return;
  }

  const ids = new Set(matched.map(n => n.id));
  matched.forEach(n => {
    n.deps.forEach(dep => ids.add(dep));
    (graphState.incoming.get(n.id) || []).forEach(parent => ids.add(parent));
  });

  applyGraphFocus(ids, "query");
  const names = [...matched.slice(0, 7).map(n => n.name)];
  const suffix = matched.length > 7 ? ` +${matched.length - 7} more` : "";
  document.getElementById("queryResult").innerText = `These files are involved in "${raw}": ${names.join(", ")}${suffix}`;
}

function clearQueryFocus() {
  document.getElementById("nlQuery").value = "";
  document.getElementById("queryResult").innerText = "Ask about auth, API flow, database, config, tests, or services.";
  clearGraphFocus();
}

async function analyzeAndRender(repoUrl, repoName, githubToken = "") {
  document.getElementById("repoName").innerText = `${repoName} · analyzing...`;
  try {
    const mode = await runAnalysis(repoUrl, githubToken);
    document.getElementById("repoName").innerText = `${repoName} · ${mode.toUpperCase()} MODE`;
    updateStats();
    loadOnboarding();
    updateInsights();
    renderGraph();
    document.getElementById("details").innerHTML = "Click a node";
    return true;
  } catch (err) {
    document.getElementById("repoName").innerText = `${repoName} · LIVE MODE UNAVAILABLE`;
    setStatus(`Live analysis failed: ${err.message}. Start backend at ${API_BASE}.`, "error");
    data = { nodes: [] };
    updateStats();
    loadOnboarding();
    updateInsights();
    renderGraph();
    document.getElementById("details").innerHTML = `
      <p><strong>Live analysis failed.</strong></p>
      <p>${err.message}</p>
      <p>Make sure backend is running at <code>${API_BASE}</code>.</p>
    `;
    return false;
  }
}

function initializePage() {
  document.getElementById("settingsBtn").onclick = () => { document.getElementById("repoModal").style.display = "flex"; };
  document.getElementById("closeModal").onclick = () => { document.getElementById("repoModal").style.display = "none"; };
  document.getElementById("repoModal").onclick = event => { if (event.target === document.getElementById("repoModal")) document.getElementById("repoModal").style.display = "none"; };
  document.getElementById("resetViewBtn").onclick = () => { renderGraph(); clearQueryFocus(); };

  document.getElementById("runQueryBtn").onclick = runNaturalLanguageQuery;
  document.getElementById("clearQueryBtn").onclick = clearQueryFocus;
  document.getElementById("nlQuery").addEventListener("keypress", event => { if (event.key === "Enter") runNaturalLanguageQuery(); });

  document.getElementById("analyzeBtn").onclick = async () => {
    const repoUrl = document.getElementById("repoUrl").value.trim();
    const githubToken = document.getElementById("githubToken").value.trim();
    if (!repoUrl) return setStatus("Please enter a GitHub repository URL", "error");
    if (!repoUrl.includes("github.com")) return setStatus("Please enter a valid GitHub URL", "error");
    if (githubToken) localStorage.setItem(GITHUB_TOKEN_KEY, githubToken);
    const repoName = repoUrl.replace("https://github.com/", "").replace("github.com/", "").split("/").slice(0, 2).join(" / ");
    localStorage.setItem("repoName", repoName);
    localStorage.setItem("repoUrl", repoUrl);
    const ok = await analyzeAndRender(repoUrl, repoName, githubToken || localStorage.getItem(GITHUB_TOKEN_KEY) || "");
    if (ok) document.getElementById("repoModal").style.display = "none";
  };

  document.getElementById("search").oninput = event => {
    searchQuery = event.target.value.toLowerCase();
    renderGraph();
  };

  document.querySelectorAll("#filters li").forEach(li => {
    li.onclick = () => {
      currentFilter = li.dataset.type;
      updateFilterButtons();
      renderGraph();
    };
  });

  updateFilterButtons();
  const savedUrl = localStorage.getItem("repoUrl");
  const savedName = localStorage.getItem("repoName") || "Repo Navigator";
  const savedToken = localStorage.getItem(GITHUB_TOKEN_KEY) || "";
  if (document.getElementById("githubToken")) {
    document.getElementById("githubToken").value = savedToken;
  }
  document.getElementById("repoName").innerText = savedName;

  if (savedUrl) {
    analyzeAndRender(savedUrl, savedName, savedToken);
  } else {
    data = enrichData(generateMockData("React App"));
    updateStats();
    loadOnboarding();
    updateInsights();
    renderGraph();
  }
}

document.addEventListener("DOMContentLoaded", initializePage);
