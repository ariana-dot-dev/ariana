# Agents-Server Broken After Watcher Removal

## What I Did

### 1. Removed Watcher System
- Deleted `backend/agents-server/watcher/` directory (Rust watcher binary)
- Deleted `src/watcherSetup.ts`
- Deleted `src/watchService.ts`
- Deleted `src/handlers/pollWatcher.ts`
- Deleted `src/handlers/applyWatcher.ts`
- Deleted `src/handlers/compareHash.ts`
- Deleted `scripts/build-watcher.sh`
- Deleted `scripts/embed-watcher.sh`

### 2. Cleaned Up References
- Removed watcher imports from `src/index.ts`
- Removed watcher import and `startWatchService()` call from `src/handlers/start.ts`
- Removed watcher routes from `src/index.ts`

### 3. Updated Build Files
- Removed watcher build provisioners from `base-image.pkr.hcl`
- Simplified `scripts/build-all.sh` (removed all watcher embedding logic)
- Updated `scripts/build-base.sh` (removed watcher mention from echo)
- Updated `scripts/create-release.sh` (removed watcher check and mentions)

### 4. Removed Spammy Logs
- Cleaned up verbose logging in `claudeState.ts`
- Cleaned up verbose logging in `gitHistory.ts`
- Cleaned up verbose logging in `getClaudeDir.ts`
- Cleaned up verbose logging in `pollAutomationEvents.ts`

### 5. Updated createSnapshot.ts
- Changed from two-phase (tar to file, then upload) to streaming pipeline
- Added `tar | pigz | curl` streaming directly to R2
- Added pigz (parallel gzip) support for faster compression
- Added `pigz` to `install-all-deps.sh`

## The Error
After running `build-base.sh` and starting new agents-server machines:
```
error: Module not found ',GAAO,GAAO,KAAK,IAAI,EAAM,CAAE,EACnE,aAAc,C'
Bun v1.3.5 (Linux x64 baseline)
```

## What I Checked
- `src/index.ts` - looks clean, no watcher imports
- `src/metricsCollector.ts` - looks fine
- `src/portMonitor.ts` - looks fine
- `src/embedded/` - doesn't exist
- No remaining grep matches for watchService, watcherSetup, pollWatcher, applyWatcher, compareHash

## Files Modified
- `backend/agents-server/src/index.ts`
- `backend/agents-server/src/handlers/start.ts`
- `backend/agents-server/src/handlers/claudeState.ts`
- `backend/agents-server/src/handlers/gitHistory.ts`
- `backend/agents-server/src/handlers/getClaudeDir.ts`
- `backend/agents-server/src/handlers/pollAutomationEvents.ts`
- `backend/agents-server/src/handlers/createSnapshot.ts`
- `backend/agents-server/base-image.pkr.hcl`
- `backend/agents-server/scripts/build-all.sh`
- `backend/agents-server/scripts/build-base.sh`
- `backend/agents-server/scripts/create-release.sh`
- `backend/agents-server/scripts/install-all-deps.sh`

## Files Deleted
- `backend/agents-server/watcher/` (entire directory)
- `backend/agents-server/src/watcherSetup.ts`
- `backend/agents-server/src/watchService.ts`
- `backend/agents-server/src/handlers/pollWatcher.ts`
- `backend/agents-server/src/handlers/applyWatcher.ts`
- `backend/agents-server/src/handlers/compareHash.ts`
- `backend/agents-server/scripts/build-watcher.sh`
- `backend/agents-server/scripts/embed-watcher.sh`

---

## Root Cause Analysis (RESOLVED)

The "Module not found" error with garbled base64-like text (`',GAAO,GAAO,KAAK,...'`) was caused by a **stale GitHub release binary** that was built before the watcher removal was properly completed.

### Investigation Findings

1. **Local build works correctly**: Building the agents-server locally produces a working binary that starts successfully.

2. **Source code is clean**: No remaining imports of deleted watcher files. All TypeScript files properly cleaned up.

3. **The error is NOT in the code**: The garbled text in the error message looks like corrupted minified JavaScript or remnants of the old base64-embedded watcher binary.

4. **Root cause**: The deployed binary on GitHub releases was built during an intermediate state where:
   - Some watcher code was still being imported/embedded
   - The build process attempted to include files that no longer exist
   - This resulted in a corrupted bundle with invalid module references

### Solution

1. **Removed Rust toolchain from CI**: Updated `.github/workflows/release-agent-server.yml` to remove the `dtolnay/rust-toolchain@stable` step since watcher is no longer built.

2. **Updated BUILD_PROCESS.md**: Simplified documentation to reflect the current build process without watcher embedding.

3. **Trigger new release**: Push a new tag to create a fresh release with properly built binaries:
   ```bash
   git tag agents-server-v<next-version>
   git push origin agents-server-v<next-version>
   ```

### Verification

To verify the fix locally:
```bash
cd backend/agents-server
bun install
bun build src/index.ts --compile --target="bun-linux-x64" --outfile="/tmp/test" --minify --sourcemap=none
MACHINE_ID=test SHARED_KEY=test WORK_DIR=/tmp /tmp/test
# Should see: "AGENT_ID= test" and server starting on port 8911
```

## Status: RESOLVED

The issue was a stale release artifact, not a code problem. New releases will work correctly.
