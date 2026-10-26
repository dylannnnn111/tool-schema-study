# Reproduces the published results from a clean machine: runs the tests, then re-scores every saved
# transcript in runs/main against the saved fixtures and checks results.json comes out byte for byte
# the same. No API key and no network needed.
#   docker build -t tool-schema-study . && docker run --rm tool-schema-study
FROM node:22-slim
WORKDIR /app
COPY . .
CMD ["sh", "-c", "npm test && cp results.json /tmp/published.json && npm run analyse && cmp results.json /tmp/published.json && echo 'Results reproduced exactly from the saved transcripts.'"]
