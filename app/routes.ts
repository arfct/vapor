import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new.ts"),
  route(":id/agents", "routes/doc.$id.agents.ts"),
  route(":id", "routes/doc.$id.tsx"),
] satisfies RouteConfig;
