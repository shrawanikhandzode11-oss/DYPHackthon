function renderGraph() {
  const width = document.getElementById("graph").clientWidth;
  const height = document.getElementById("graph").clientHeight;

  const svg = d3.select("#graph")
    .html("")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .call(d3.zoom().on("zoom", (event) => {
      g.attr("transform", event.transform);
    }));

  const g = svg.append("g");

  // ✅ BUILD LINKS
  const links = [];
  data.nodes.forEach(n => {
    n.deps.forEach(d => {
      links.push({ source: n.id, target: d });
    });
  });

  const simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(120))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(width / 2, height / 2));

  // 🔗 EDGES
  const link = g.selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("stroke", "#22c55e")
    .attr("stroke-opacity", 0.3)
    .attr("stroke-width", 1.5);

  // 🔵 NODES
  const node = g.selectAll("circle")
    .data(data.nodes)
    .enter()
    .append("circle")
    .attr("r", d => d.risk >= 3 ? 12 : 8)
    .attr("fill", d => {
      if (d.type === "entry") return "#22c55e";
      if (d.type === "service") return "orange";
      return "#3b82f6";
    })
    .on("click", (event, d) => {
      event.stopPropagation();

      const details = buildDetails(d, links);
      localStorage.setItem("file", JSON.stringify(details));
      window.location.href = "details.html";
    })
    .on("mouseover", highlightNode)
    .on("mouseout", resetHighlight)
    .call(d3.drag()
      .on("start", dragStart)
      .on("drag", dragging)
      .on("end", dragEnd)
    );

  // 🏷 LABELS
  const label = g.selectAll("text")
    .data(data.nodes)
    .enter()
    .append("text")
    .text(d => d.name)
    .attr("font-size", "10px")
    .attr("fill", "#aaa");

  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    label
      .attr("x", d => d.x + 10)
      .attr("y", d => d.y + 3);
  });

  // 🔍 HIGHLIGHT
  function highlightNode(event, d) {
    link.attr("stroke-opacity", l =>
      l.source.id === d.id || l.target.id === d.id ? 1 : 0.05
    );
  }

  function resetHighlight() {
    link.attr("stroke-opacity", 0.3);
  }

  // 🧲 DRAG
  function dragStart(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragging(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnd(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
}

// 🧠 BUILD DETAILS (NEW)
function buildDetails(node, links) {
  const dependencies = links
    .filter(l => l.source.id === node.id)
    .map(l => getName(l.target.id));

  const dependents = links
    .filter(l => l.target.id === node.id)
    .map(l => getName(l.source.id));

  const role = getRole(node.name);

  return {
    ...node,
    dependencies,
    dependents,
    role,
    description: `${node.name} handles ${role.toLowerCase()} in the system.`
  };
}

// 🧠 ROLE DETECTION
function getRole(name) {
  const n = name.toLowerCase();
  if (n.includes("auth")) return "Authentication logic";
  if (n.includes("api")) return "API communication";
  if (n.includes("service")) return "Business logic";
  if (n.includes("config")) return "Configuration";
  return "General module";
}