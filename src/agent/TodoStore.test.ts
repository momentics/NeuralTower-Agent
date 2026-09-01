import { describe, it, expect } from "vitest"
import { TodoStore, type ITodoItem } from "./TodoStore"

const makeItem = (
  content = "Task",
  status: ITodoItem["status"] = "pending",
  priority: ITodoItem["priority"] = "medium",
): ITodoItem => ({ content, status, priority })

describe("TodoStore", () => {
  it("starts empty", () => {
    const store = new TodoStore()
    expect(store.getItems()).toEqual([])
  })

  it("setItems replaces all items", () => {
    const store = new TodoStore()
    const items = [makeItem("A", "pending", "high"), makeItem("B", "in_progress", "low")]
    store.setItems(items)
    expect(store.getItems()).toHaveLength(2)
    expect(store.getItems()[0].content).toBe("A")
    expect(store.getItems()[1].content).toBe("B")
  })

  it("setItems overwrites previous items", () => {
    const store = new TodoStore()
    store.setItems([makeItem("A")])
    store.setItems([makeItem("B")])
    expect(store.getItems()).toHaveLength(1)
    expect(store.getItems()[0].content).toBe("B")
  })

  it("getItems returns a copy", () => {
    const store = new TodoStore()
    store.setItems([makeItem("A")])
    const copy = store.getItems()
    copy.push(makeItem("B"))
    expect(store.getItems()).toHaveLength(1)
  })

  it("clear removes all items", () => {
    const store = new TodoStore()
    store.setItems([makeItem("A"), makeItem("B")])
    store.clear()
    expect(store.getItems()).toEqual([])
  })

  it("formatItems shows correct counts", () => {
    const store = new TodoStore()
    store.setItems([
      makeItem("A", "pending", "high"),
      makeItem("B", "in_progress", "medium"),
      makeItem("C", "completed", "low"),
    ])
    const formatted = store.formatItems()
    expect(formatted).toContain("2 активных")
    expect(formatted).toContain("1 завершено")
  })

  it("formatItems shows correct icons", () => {
    const store = new TodoStore()
    store.setItems([
      makeItem("A", "pending", "high"),
      makeItem("B", "in_progress", "medium"),
      makeItem("C", "completed", "low"),
      makeItem("D", "cancelled", "low"),
    ])
    const formatted = store.formatItems()
    expect(formatted).toContain("[ ]")
    expect(formatted).toContain("[~]")
    expect(formatted).toContain("[x]")
    expect(formatted).toContain("[-]")
  })

  it("formatItems shows numbered items", () => {
    const store = new TodoStore()
    store.setItems([makeItem("First"), makeItem("Second")])
    const formatted = store.formatItems()
    expect(formatted).toContain("[1] First")
    expect(formatted).toContain("[2] Second")
  })

  it("formatItems with empty list", () => {
    const store = new TodoStore()
    const formatted = store.formatItems()
    expect(formatted).toContain("0 активных")
    expect(formatted).toContain("0 завершено")
  })

  it("onDidChange вызывается при setItems и clear", () => {
    const store = new TodoStore()
    const calls: ITodoItem[][] = []
    store.onDidChange = (items) => calls.push(items)
    store.setItems([{ content: "a", status: "pending", priority: "high" }])
    store.clear()
    expect(calls.length).toBe(2)
    expect(calls[0].length).toBe(1)
    expect(calls[1].length).toBe(0)
  })
})
