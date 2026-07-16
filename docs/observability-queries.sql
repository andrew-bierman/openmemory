-- OpenMemory Workers Analytics Engine saved queries.
-- Dataset: openmemory_events
-- Blob columns:
--   blob1 = event
--   blob2 = method or path
--   blob3 = path or message
--   blob4 = status class
--   blob5 = status
--   blob6 = rate limited
--   blob7 = colo
-- Double columns:
--   double1 = status or error count
--   double2 = durationMs
--   double3 = rateLimited as 0/1

-- Request volume and latency by route over the last hour.
SELECT
  intDiv(toUInt32(timestamp), 300) * 300 AS bucket,
  blob2 AS method,
  blob3 AS path,
  count() AS requests,
  avg(double2) AS avg_duration_ms,
  max(double2) AS max_duration_ms
FROM openmemory_events
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
  AND blob1 = 'openmemory.request'
GROUP BY bucket, method, path
ORDER BY bucket DESC, requests DESC;

-- Request errors emitted by the Worker catch path.
SELECT
  intDiv(toUInt32(timestamp), 300) * 300 AS bucket,
  blob2 AS path,
  blob3 AS message,
  count() AS errors
FROM openmemory_events
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
  AND blob1 = 'openmemory.request_error'
GROUP BY bucket, path, message
ORDER BY bucket DESC, errors DESC;

-- 5xx responses by route.
SELECT
  intDiv(toUInt32(timestamp), 300) * 300 AS bucket,
  blob2 AS method,
  blob3 AS path,
  blob5 AS status,
  count() AS responses
FROM openmemory_events
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
  AND blob1 = 'openmemory.request'
  AND blob4 = '5xx'
GROUP BY bucket, method, path, status
ORDER BY bucket DESC, responses DESC;

-- Rate-limit pressure.
SELECT
  intDiv(toUInt32(timestamp), 300) * 300 AS bucket,
  blob2 AS method,
  blob3 AS path,
  count() AS responses,
  sum(double3) AS rate_limited_responses
FROM openmemory_events
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
  AND blob1 = 'openmemory.request'
  AND blob6 = 'true'
GROUP BY bucket, method, path
ORDER BY bucket DESC, rate_limited_responses DESC;

-- Async worker failures.
SELECT
  intDiv(toUInt32(timestamp), 300) * 300 AS bucket,
  blob1 AS event,
  blob2 AS scope,
  blob3 AS message,
  count() AS failures
FROM openmemory_events
WHERE timestamp >= NOW() - INTERVAL '1' HOUR
  AND blob1 IN (
    'openmemory.source_ingestion_error',
    'openmemory.memory_extraction_error'
  )
GROUP BY bucket, event, scope, message
ORDER BY bucket DESC, failures DESC;
