const data = {
  nodes: [
    { id: "1", name: "server.ts", type: "entry", risk: 3, deps: ["2","3"], summary: "HTTP server wrapper with graceful shutdown" },
    { id: "2", name: "app.ts", type: "entry", risk: 2, deps: ["4"], summary: "Main app config" },
    { id: "3", name: "AuthService.ts", type: "service", risk: 3, deps: [], summary: "Authentication logic" },
    { id: "4", name: "UserService.ts", type: "service", risk: 2, deps: ["5"], summary: "User operations" },
    { id: "5", name: "database.ts", type: "util", risk: 2, deps: [], summary: "Database connection" },
    { id: "6", name: "config.ts", type: "config", risk: 1, deps: [], summary: "Environment config" },
    { id: "7", name: "test.spec.ts", type: "test", risk: 1, deps: [], summary: "Unit tests" }
  ]
};