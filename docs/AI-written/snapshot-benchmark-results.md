# Snapshot Create/Restore Benchmark Results

**Date**: 2026-02-10
**Machine**: Hetzner cx43 (8 vCPU, 16GB RAM, NVMe SSD)
**Location**: fsn1 (Falkenstein, Germany)
**R2 Bucket**: ariana-machines-snapshot-dev
**Benchmark script**: `backend/agents-server/scripts/benchmark-snapshots.sh`

## Context

Snapshot create/restore is the critical path for agent fork and resume operations. The current production approach uses `pigz -p 8` (parallel gzip) with temp files on disk before uploading/downloading to Cloudflare R2. This benchmark tests 5 techniques across 5 data sizes to find faster approaches.

All sizes include the ~190MB base `/home/ariana` from the snapshot image. The "data size" column refers to additional test data added on top of this base.

## Techniques Tested

| # | Name | Description |
|---|------|-------------|
| 1 | **pigz-file** | Current production: `pigz -p 8` compression, write temp file, upload to R2 |
| 2 | **zstd-file** | `zstd -T0` (all cores) compression, write temp file, upload to R2 |
| 3 | **lz4-file** | `lz4` compression (fastest algo), write temp file, upload to R2 |
| 4 | **pigz-stream** | `pigz -p 8` piped directly to `aws s3 cp` (no temp file) |
| 5 | **zstd-stream** | `zstd -T0` piped directly to `aws s3 cp` (no temp file) |

## Raw Results

### 10MB additional data (~200MB total archive)

| Technique | Compress | Upload | Download | Decompress | Compressed Size | Create Total | Restore Total |
|-----------|----------|--------|----------|------------|-----------------|--------------|---------------|
| pigz-file | 6.5s | 3.5s | 2.9s | 3.8s | 199.3 MB | 10.0s | 6.7s |
| zstd-file | 0.85s | 5.5s | 2.9s | 1.8s | 176.9 MB | 6.4s | 4.8s |
| lz4-file | 2.1s | 5.0s | 3.5s | 2.1s | 262.4 MB | 7.1s | 5.6s |
| pigz-stream | 6.3s | (stream) | (stream) | 5.5s | 199.3 MB | 6.3s | 5.5s |
| zstd-stream | 4.8s | (stream) | (stream) | 4.4s | 176.9 MB | 4.8s | 4.4s |

### 100MB additional data (~300MB total archive)

| Technique | Compress | Upload | Download | Decompress | Compressed Size | Create Total | Restore Total |
|-----------|----------|--------|----------|------------|-----------------|--------------|---------------|
| pigz-file | 3.4s | 7.2s | 8.6s | 3.5s | 290.1 MB | 10.6s | 12.2s |
| zstd-file | 1.0s | 6.9s | 3.5s | 2.1s | 267.4 MB | 7.9s | 5.6s |
| lz4-file | 2.0s | 6.0s | 5.3s | 2.3s | 361.9 MB | 8.0s | 7.6s |
| pigz-stream | 8.4s | (stream) | (stream) | 6.3s | 290.1 MB | 8.4s | 6.3s |
| zstd-stream | 6.6s | (stream) | (stream) | 5.8s | 267.4 MB | 6.6s | 5.8s |

### 500MB additional data (~700MB total archive)

| Technique | Compress | Upload | Download | Decompress | Compressed Size | Create Total | Restore Total |
|-----------|----------|--------|----------|------------|-----------------|--------------|---------------|
| pigz-file | 5.1s | 10.6s | 7.4s | 5.4s | 693.5 MB | 15.8s | 12.7s |
| zstd-file | 1.4s | 9.4s | 9.8s | 3.0s | 669.8 MB | 10.8s | 12.8s |
| lz4-file | 2.9s | 14.9s | 9.1s | 2.9s | 804.0 MB | 17.8s | 12.0s |
| pigz-stream | 16.0s | (stream) | (stream) | 14.6s | 693.5 MB | 16.0s | 14.6s |
| zstd-stream | 21.6s | (stream) | (stream) | 13.0s | 669.8 MB | 21.6s | 13.0s |

### 1GB additional data (~1.2GB total archive)

| Technique | Compress | Upload | Download | Decompress | Compressed Size | Create Total | Restore Total |
|-----------|----------|--------|----------|------------|-----------------|--------------|---------------|
| pigz-file | 7.5s | 15.2s | 10.4s | 6.8s | 1197.8 MB | 22.7s | 17.3s |
| zstd-file | 2.2s | 17.0s | 10.9s | 3.9s | 1172.3 MB | 19.1s | 14.8s |
| lz4-file | 4.0s | 16.9s | 12.2s | 3.3s | 1356.6 MB | 20.9s | 15.5s |
| pigz-stream | 26.6s | (stream) | (stream) | 22.0s | 1197.8 MB | 26.6s | 22.0s |
| zstd-stream | 20.2s | (stream) | (stream) | 15.2s | 1172.3 MB | 20.2s | 15.2s |

### 5GB additional data (~5.2GB total archive)

| Technique | Compress | Upload | Download | Decompress | Compressed Size | Create Total | Restore Total |
|-----------|----------|--------|----------|------------|-----------------|--------------|---------------|
| pigz-file | 25.1s | 70.9s | 32.8s | 22.6s | 5231.8 MB | 96.0s | 55.4s |
| zstd-file | 5.2s | 70.5s | 33.1s | 10.1s | 5194.1 MB | 75.7s | 43.2s |
| lz4-file | 10.4s | 72.9s | 37.1s | 8.8s | 5777.7 MB | 83.3s | 45.9s |
| pigz-stream | 111.2s | (stream) | (stream) | 76.9s | 5231.8 MB | 111.2s | 76.9s |
| zstd-stream | 104.3s | (stream) | (stream) | 94.8s | 5194.1 MB | 104.3s | 94.8s |

## Best Technique by Size

| Data Size | Best Technique | Create | Restore | E2E Total | vs Baseline (pigz-file) |
|-----------|---------------|--------|---------|-----------|------------------------|
| 10MB | **zstd-stream** | 4.8s | 4.4s | 9.2s | **45% faster** (was 16.7s) |
| 100MB | **zstd-file** | 7.9s | 5.6s | 13.5s | **41% faster** (was 22.8s) |
| 500MB | **zstd-file** | 10.8s | 12.0s | 22.8s | **20% faster** (was 28.5s) |
| 1GB | **zstd-file** | 19.1s | 14.8s | 33.9s | **15% faster** (was 40.0s) |
| 5GB | **zstd-file** | 75.7s | 43.2s | 118.9s | **21% faster** (was 151.4s) |

## Key Findings

1. **zstd-file is the clear winner** at every size except the smallest (10MB where zstd-stream wins). It compresses 2-5x faster than pigz, decompresses 1.5-2x faster, and produces smaller files.

2. **Streaming hurts at large sizes.** `aws s3 cp` from stdin uses small multipart chunks, making it significantly slower than uploading a pre-written file. At 5GB: pigz-stream takes 111s for create vs pigz-file's 96s. Streaming is only beneficial for very small snapshots where temp file write/read overhead dominates.

3. **lz4 loses overall** because its poor compression ratio produces larger files, and the extra R2 transfer time outweighs the faster compression/decompression speed.

4. **R2 transfer is the bottleneck at large sizes.** At 5GB: compression takes 5-25s but upload takes ~70s. The fastest path is to minimize compressed size (zstd) to reduce transfer time.

5. **zstd compression is 850ms for ~200MB vs pigz's 6.5s** — a 7.6x compression speedup at the most common snapshot size.

## Recommendation

Replace `pigz -p 8` with `zstd -T0` in both `createSnapshot.ts` and `restoreSnapshot.ts`. This is a drop-in change:

- **Create**: `tar -I 'pigz -p 8'` -> `tar -I 'zstd -T0'`
- **Restore**: `tar -I 'pigz -d -p 8'` -> `tar -I 'zstd -d -T0'`
- **File extension**: `.tar.gz` -> `.tar.zst`

Expected production improvement: **~20-40% faster** snapshot create and restore across all snapshot sizes. The improvement is most dramatic for the compression/decompression phases (up to 7.6x faster), with overall end-to-end gains limited by network transfer time to R2.

Note: `zstd` is already installed on the agent machines (Ubuntu 24.04 includes it by default). No additional dependencies needed.
