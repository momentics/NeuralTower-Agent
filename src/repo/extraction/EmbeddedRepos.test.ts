import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import {
  discoverEmbeddedRepoRoots,
  classifyGitDir,
  findNestedGitRepos,
  findIgnoredEmbeddedRepos,
} from "./EmbeddedRepos"

let tmpDir: string

beforeAll(async () => {
  tmpDir = path.join(os.tmpdir(), `ntgraph-embedded-test-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// Хелпер для создания тестового репозитория с указанными маркерами
async function createRepo(dir: string, markers: string[] = [".git"]): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  for (const marker of markers) {
    const markerPath = path.join(dir, marker)
    // Для .git создаём директорию, для остальных маркеров — файл
    if (marker === ".git") {
      await fs.mkdir(markerPath, { recursive: true })
    } else {
      await fs.writeFile(markerPath, "{}")
    }
  }
}

// --- discoverEmbeddedRepoRoots ---

describe("discoverEmbeddedRepoRoots", () => {
  it("finds nested repo with .git", async () => {
    // Создаём корневой репозиторий и вложенный репозиторий с .git
    const root = path.join(tmpDir, "disc-git")
    await createRepo(root)
    const nested = path.join(root, "nested-repo")
    await createRepo(nested)

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(nested)
  })

  it("finds nested repo with package.json", async () => {
    const root = path.join(tmpDir, "disc-pkg")
    await createRepo(root)
    const nested = path.join(root, "pkg-repo")
    await createRepo(nested, ["package.json"])

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(nested)
  })

  it("finds nested repo with go.mod", async () => {
    const root = path.join(tmpDir, "disc-go")
    await createRepo(root)
    const nested = path.join(root, "go-repo")
    await createRepo(nested, ["go.mod"])

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(nested)
  })

  it("finds nested repo with Cargo.toml", async () => {
    const root = path.join(tmpDir, "disc-rust")
    await createRepo(root)
    const nested = path.join(root, "rust-repo")
    await createRepo(nested, ["Cargo.toml"])

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(nested)
  })

  it("finds nested repo with build.gradle", async () => {
    const root = path.join(tmpDir, "disc-gradle")
    await createRepo(root)
    const nested = path.join(root, "gradle-repo")
    await createRepo(nested, ["build.gradle"])

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(nested)
  })

  it("finds nested repo with pom.xml", async () => {
    const root = path.join(tmpDir, "disc-maven")
    await createRepo(root)
    const nested = path.join(root, "maven-repo")
    await createRepo(nested, ["pom.xml"])

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(nested)
  })

  it("does not find directory without repo markers", async () => {
    const root = path.join(tmpDir, "disc-none")
    await createRepo(root)
    const subdir = path.join(root, "plain-dir")
    await fs.mkdir(subdir, { recursive: true })

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).not.toContain(subdir)
  })

  it("skips ignored directories", async () => {
    // Репозиторий внутри node_modules не должен обнаруживаться
    const root = path.join(tmpDir, "disc-ignore")
    await createRepo(root)
    const ignored = path.join(root, "node_modules", "some-pkg")
    await createRepo(ignored)

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).not.toContain(ignored)
  })

  it("finds repos at multiple nesting levels", async () => {
    // Создаём репозиторий на 2 уровня вложенности: root/a/b
    const root = path.join(tmpDir, "disc-deep")
    await createRepo(root)
    const lvl1 = path.join(root, "a")
    await fs.mkdir(lvl1, { recursive: true })
    const lvl2 = path.join(lvl1, "b")
    await createRepo(lvl2)

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(lvl2)
  })

  it("returns empty array for empty directory", async () => {
    const root = path.join(tmpDir, "disc-empty")
    await fs.mkdir(root, { recursive: true })

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toEqual([])
  })

  it("finds multiple nested repos", async () => {
    const root = path.join(tmpDir, "disc-multi")
    await createRepo(root)
    const repo1 = path.join(root, "repo1")
    const repo2 = path.join(root, "repo2")
    await createRepo(repo1)
    await createRepo(repo2)

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).toContain(repo1)
    expect(results).toContain(repo2)
  })

  it("skips .git as subdirectory of marker", async () => {
    // .git директория корневого репозитория не должна считаться вложенным репозиторием
    const root = path.join(tmpDir, "disc-dotgit")
    await createRepo(root)

    const results = await discoverEmbeddedRepoRoots(root)
    expect(results).not.toContain(path.join(root, ".git"))
  })
})

// --- classifyGitDir ---

describe("classifyGitDir", () => {
  it("classifies regular .git directory as embedded", () => {
    const dir = path.join(tmpDir, "classify-embedded")
    fsSync.mkdirSync(path.join(dir, ".git"), { recursive: true })

    const result = classifyGitDir(dir)
    expect(result).toBe("embedded")
  })

  it("classifies .git with gitdir pointing outside as worktree", () => {
    // gitdir указывает на внешний путь — это worktree, а не embedded
    const dir = path.join(tmpDir, "classify-worktree")
    const gitDir = path.join(dir, ".git")
    fsSync.mkdirSync(gitDir, { recursive: true })
    fsSync.writeFileSync(
      path.join(gitDir, "gitdir"),
      `/some/external/path/.git/worktrees/mytree`
    )

    const result = classifyGitDir(dir)
    expect(result).toBe("worktree")
  })

  it("returns none when .git is absent", () => {
    const dir = path.join(tmpDir, "classify-none")
    fsSync.mkdirSync(dir, { recursive: true })

    const result = classifyGitDir(dir)
    expect(result).toBe("none")
  })

  it("returns none for non-existent directory", () => {
    const result = classifyGitDir(path.join(tmpDir, "does-not-exist"))
    expect(result).toBe("none")
  })

  it("classifies .git file with gitdir outside as worktree", () => {
    // .git — это файл (не директория) с gitdir, указывающим на внешний путь
    const dir = path.join(tmpDir, "classify-worktree-file")
    fsSync.mkdirSync(dir, { recursive: true })
    fsSync.writeFileSync(
      path.join(dir, ".git"),
      `gitdir: /some/external/path/.git/worktrees/mytree`
    )

    const result = classifyGitDir(dir)
    expect(result).toBe("worktree")
  })

  it("classifies .git file with gitdir inside as embedded", () => {
    const dir = path.join(tmpDir, "classify-embedded-file")
    fsSync.mkdirSync(dir, { recursive: true })
    // gitdir указывает на поддиректорию внутри текущего репозитория — это embedded
    fsSync.writeFileSync(
      path.join(dir, ".git"),
      `gitdir: common/.git/modules/${path.basename(dir)}`
    )

    const result = classifyGitDir(dir)
    expect(result).toBe("embedded")
  })

  it("classifies .git file without gitdir as embedded", () => {
    // .git файл без gitdir считается обычным embedded репозиторием
    const dir = path.join(tmpDir, "classify-embedded-bare")
    fsSync.mkdirSync(dir, { recursive: true })
    fsSync.writeFileSync(path.join(dir, ".git"), "some other content")

    const result = classifyGitDir(dir)
    expect(result).toBe("embedded")
  })

  it("classifies .git directory with gitdir inside as embedded", () => {
    const dir = path.join(tmpDir, "classify-embedded-gitdir")
    const gitDir = path.join(dir, ".git")
    fsSync.mkdirSync(gitDir, { recursive: true })
    // gitdir указывает на относительный путь внутри .git — это embedded
    fsSync.writeFileSync(
      path.join(gitDir, "gitdir"),
      `./modules/${path.basename(dir)}`
    )

    const result = classifyGitDir(dir)
    expect(result).toBe("embedded")
  })
})

// --- findNestedGitRepos ---

describe("findNestedGitRepos", () => {
  it("finds nested git repo", () => {
    const root = path.join(tmpDir, "find-nested-1")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const nested = path.join(root, "subrepo")
    fsSync.mkdirSync(path.join(nested, ".git"), { recursive: true })

    const results = findNestedGitRepos(root, "")
    expect(results).toContain("subrepo")
  })

  it("returns relative paths", () => {
    const root = path.join(tmpDir, "find-nested-rel")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const nested = path.join(root, "a", "b", "subrepo")
    fsSync.mkdirSync(path.join(nested, ".git"), { recursive: true })

    const results = findNestedGitRepos(root, "")
    expect(results).toContain("a/b/subrepo")
  })

  it("skips .git directory", () => {
    const root = path.join(tmpDir, "find-nested-git")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })

    const results = findNestedGitRepos(root, "")
    expect(results).not.toContain(".git")
  })

  it("skips ignored directories", () => {
    const root = path.join(tmpDir, "find-nested-ignore")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const ignored = path.join(root, "node_modules", "pkg")
    fsSync.mkdirSync(path.join(ignored, ".git"), { recursive: true })

    const results = findNestedGitRepos(root, "")
    expect(results).not.toContain("node_modules/pkg")
  })

  it("returns empty array if no nested repos", () => {
    const root = path.join(tmpDir, "find-nested-empty")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })

    const results = findNestedGitRepos(root, "")
    expect(results).toEqual([])
  })

  it("finds multiple nested repos", () => {
    const root = path.join(tmpDir, "find-nested-multi")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    fsSync.mkdirSync(path.join(root, "repo1", ".git"), { recursive: true })
    fsSync.mkdirSync(path.join(root, "repo2", ".git"), { recursive: true })

    const results = findNestedGitRepos(root, "")
    expect(results).toContain("repo1")
    expect(results).toContain("repo2")
  })

  it("does not include worktree as embedded", () => {
    // Создаём вложенный репозиторий с gitdir, указывающим вовне — это worktree
    const root = path.join(tmpDir, "find-nested-worktree")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const wt = path.join(root, "worktree-repo")
    const wtGit = path.join(wt, ".git")
    fsSync.mkdirSync(wtGit, { recursive: true })
    fsSync.writeFileSync(
      path.join(wtGit, "gitdir"),
      `/some/external/path/.git/worktrees/mytree`
    )

    const results = findNestedGitRepos(root, "")
    expect(results).not.toContain("worktree-repo")
  })

  it("supports relPrefix", () => {
    // relPrefix добавляется к началу возвращаемого относительного пути
    const root = path.join(tmpDir, "find-nested-prefix")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const nested = path.join(root, "subrepo")
    fsSync.mkdirSync(path.join(nested, ".git"), { recursive: true })

    const results = findNestedGitRepos(root, "vendor")
    expect(results).toContain("vendor/subrepo")
  })

  it("finds repo with .git file", () => {
    const root = path.join(tmpDir, "find-nested-gitfile")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const nested = path.join(root, "subrepo")
    fsSync.mkdirSync(nested, { recursive: true })
    fsSync.writeFileSync(path.join(nested, ".git"), "gitdir: /some/path")

    const results = findNestedGitRepos(root, "")
    // .git файл с gitdir, указывающим вовне — это worktree, поэтому исключается
    expect(results).not.toContain("subrepo")
  })

  it("finds repo with .git file pointing inside", () => {
    const root = path.join(tmpDir, "find-nested-gitfile-embed")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const nested = path.join(root, "subrepo")
    fsSync.mkdirSync(nested, { recursive: true })
    // gitdir указывает на путь внутри subrepo — классифицируется как embedded
    fsSync.writeFileSync(
      path.join(nested, ".git"),
      `gitdir: ${path.resolve(nested, "common/.git/modules/subrepo")}`
    )

    const results = findNestedGitRepos(root, "")
    expect(results).toContain("subrepo")
  })
})

// --- findIgnoredEmbeddedRepos ---

describe("findIgnoredEmbeddedRepos", () => {
  it("finds repo in ignored directory", () => {
    const root = path.join(tmpDir, "find-ignored-1")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const vendor = path.join(root, "vendor", "pkg")
    fsSync.mkdirSync(path.join(vendor, ".git"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).toContain("vendor/pkg")
  })

  it("skips non-ignored directories", () => {
    const root = path.join(tmpDir, "find-ignored-skip")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const srcRepo = path.join(root, "src", "pkg")
    fsSync.mkdirSync(path.join(srcRepo, ".git"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).not.toContain("src/pkg")
  })

  it("returns empty array if no repos in ignored directories", () => {
    const root = path.join(tmpDir, "find-ignored-empty")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    fsSync.mkdirSync(path.join(root, "node_modules"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).toEqual([])
  })

  it("finds nested repos in ignored directories", () => {
    const root = path.join(tmpDir, "find-ignored-nested")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const deep = path.join(root, "node_modules", "pkg", "subpkg")
    fsSync.mkdirSync(path.join(deep, ".git"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).toContain("node_modules/pkg/subpkg")
  })

  it("finds repo in vendor directory", () => {
    const root = path.join(tmpDir, "find-ignored-vendor")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const vendorRepo = path.join(root, "vendor", "mylib")
    fsSync.mkdirSync(path.join(vendorRepo, ".git"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).toContain("vendor/mylib")
  })

  it("does not include worktree from ignored directories", () => {
    // Worktree внутри игнорируемой директории тоже исключается
    const root = path.join(tmpDir, "find-ignored-worktree")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const wt = path.join(root, "vendor", "wt-repo")
    const wtGit = path.join(wt, ".git")
    fsSync.mkdirSync(wtGit, { recursive: true })
    fsSync.writeFileSync(
      path.join(wtGit, "gitdir"),
      `/some/external/path/.git/worktrees/mytree`
    )

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).not.toContain("vendor/wt-repo")
  })

  it("finds multiple repos in different ignored directories", () => {
    const root = path.join(tmpDir, "find-ignored-multi")
    fsSync.mkdirSync(path.join(root, ".git"), { recursive: true })
    const vendorRepo = path.join(root, "vendor", "lib1")
    fsSync.mkdirSync(path.join(vendorRepo, ".git"), { recursive: true })
    const nmRepo = path.join(root, "node_modules", "lib2")
    fsSync.mkdirSync(path.join(nmRepo, ".git"), { recursive: true })

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).toContain("vendor/lib1")
    expect(results).toContain("node_modules/lib2")
  })

  it("safely handles directory without .git", () => {
    // Директория без .git не является репозиторием — возвращаем пустой массив
    const root = path.join(tmpDir, "find-ignored-no-git")
    fsSync.mkdirSync(root, { recursive: true })

    const results = findIgnoredEmbeddedRepos(root)
    expect(results).toEqual([])
  })

  it("safely handles non-existent directory", () => {
    // Несуществующая директория не вызывает ошибок
    const results = findIgnoredEmbeddedRepos(path.join(tmpDir, "no-such-dir"))
    expect(results).toEqual([])
  })
})
