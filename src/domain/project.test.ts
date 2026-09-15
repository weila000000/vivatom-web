import { describe, expect, it } from "vitest"
import { createProject, transitionProject } from "./project"

describe("project state machine", () => {
  it("follows the plan and build happy path", () => {
    let project = createProject("任务板")
    project = transitionProject(project, "start_plan")
    expect(project.status).toBe("planning")
    project = transitionProject(project, "plan_ready")
    expect(project.status).toBe("awaiting_approval")
    project = transitionProject(project, "approve")
    expect(project.status).toBe("building")
    project = transitionProject(project, "build_succeeded")
    expect(project.status).toBe("ready")
  })

  it("rejects approval before a plan exists", () => {
    const project = createProject("任务板")
    expect(() => transitionProject(project, "approve")).toThrow(
      "项目处于 draft 时不能执行 approve",
    )
    expect(project.status).toBe("draft")
  })
})
