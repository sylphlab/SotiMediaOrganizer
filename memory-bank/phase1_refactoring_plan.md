<!-- Version: 1.0 | Last Updated: 2025-04-05 | Updated By: Cline -->

# MediaCurator Refactoring - Phase 1 Plan: Foundational FP &amp; Dependencies

**Based on:** `major_refactoring_plan_v1.md`
**Date Finalized:** 2025-04-05

## 1. Goals for Phase 1

- Establish a robust functional error handling pattern using a `Result` type.
- Remove the `Inversify` dependency injection framework.
- Implement a simple, explicit dependency management strategy.
- Begin refactoring core logic (`MediaComparator`) and other imperative sections towards pure functions.
- Lay the groundwork for subsequent phases focusing on scalability (Phase 2) and UI (Phase 3).

## 2. Confirmed Technical Approach

- **`Result` Type Implementation:** Use the `neverthrow` library.
- **Dependency Management Strategy:** Use Manual Injection (pass dependencies explicitly as function arguments).

## 3. Phase 1 Tasks

```mermaid
graph TD
    Start[Phase 1 Start] --> T1_1[Task 1.1: Implement Result Type (neverthrow) &amp; Error Handling]
    Start --> T1_3[Task 1.3: Implement Manual Injection (Remove Inversify)]

    T1_1 --> T1_2[Task 1.2: Refactor MediaComparator Logic (Pure Functions w/ Result)]
    T1_3 --> T1_2

    T1_1 --> T1_4[Task 1.4: Refactor Remaining Imperative Code (Pure Functions w/ Result)]
    T1_3 --> T1_4

    T1_2 --> End[Phase 1 Tasks Planned]
    T1_4 --> End
```

### Task 1.1: Implement `Result` Type (`neverthrow`) & Standardize Error Handling

- **Objective:** Replace exception-based error handling with a functional approach using `neverthrow`.
- **Action 1.1.1:** Add `neverthrow` as a project dependency.
- **Action 1.1.2:** Define standard error types/codes for common failure scenarios (e.g., `FileNotFoundError`, `ToolExecutionError`, `InvalidDataError`). These could be simple string constants or dedicated error classes/objects.
- **Action 1.1.3:** Identify functions currently throwing errors or returning potentially invalid states (start with `utils.ts`, `comparatorUtils.ts`, `external/` wrappers, `jobs/`).
- **Action 1.1.4:** Refactor identified functions incrementally to return `Result<SuccessType, ErrorType>` from `neverthrow` instead of throwing exceptions. Use `ok()` for success and `err()` for failure.

### Task 1.2: Deep Refactor of `MediaComparator.ts` Logic

- **Objective:** Extract core computational logic from `MediaComparator.ts` into pure functions using `neverthrow`'s `Result`.
- **Action 1.2.1:** Analyze `MediaComparator.ts` to separate pure computations (VPTree building, searching, DBSCAN logic, scoring) from side effects (caching interactions, logging).
- **Action 1.2.2:** Create new pure functions (e.g., `buildVPTreeFn`, `searchVPTreeFn`, `runDBSCANFn`, `calculateSimilarityScoreFn`) in `comparatorUtils.ts` or a new dedicated module. These functions will accept necessary data and configuration explicitly and return a `Result`.
- **Action 1.2.3:** Handle state (like the built VPTree) by passing it explicitly between functions for now.
- **Action 1.2.4:** Update callers of the original `MediaComparator` methods to use the new pure functions and handle the returned `Result` (e.g., using `map`, `andThen`, `match`).

### Task 1.3: Implement Manual Injection (Remove Inversify)

- **Objective:** Remove `Inversify` and pass dependencies explicitly.
- **Action 1.3.1:** Identify all services/configurations currently managed by `Inversify` (review `Context.ts`).
- **Action 1.3.2:** Remove all `inversify` decorators (`@injectable`, `@inject`, etc.) and the `Context.ts` container setup. Remove `inversify` and `reflect-metadata` dependencies.
- **Action 1.3.3:** Refactor the application entry point (`index.ts`) to instantiate necessary dependencies (like configuration objects, cache module instances, tool runners).
- **Action 1.3.4:** Modify pipeline functions (`discovery.ts`, `gatherer.ts`, etc.) and any functions they call to accept required dependencies as parameters. Pass these dependencies down the call chain from `index.ts`.

### Task 1.4: Refactor Remaining Imperative Code

- **Objective:** Convert other imperative code sections into pure functions or clearly isolated side-effecting modules using `neverthrow`.
- **Action 1.4.1:** Review key areas like `fileProcessor.ts`, `jobs/` functions, and `external/` wrappers.
- **Action 1.4.2:** For computational logic, refactor into pure functions returning `Result`.
- **Action 1.4.3:** For side-effecting logic, ensure it's clearly isolated and returns a `Result` (e.g., a function wrapping an `exiftool` call should return `Result<Metadata, ExifToolError>`).

## 4. Next Steps

With this plan documented, the next logical step is to begin implementation, likely by switching to **Code** mode to execute the tasks outlined above, starting with Task 1.1 and Task 1.3.
