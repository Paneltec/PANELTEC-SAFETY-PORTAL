# Paneltec Safety Portal: website + phone viewer (self-hosted)
# The JavaScript is built once on the build machine; only nginx is per-architecture.
ARG NODE_IMAGE=node:22-bookworm
ARG PLACEHOLDER=https://paneltec-public-url.invalid

# ── Web portal ─────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS portal
ARG PLACEHOLDER
WORKDIR /src/frontend
COPY frontend/ ./
COPY deploy/strip_emergent.py /tmp/strip_emergent.py
RUN python3 /tmp/strip_emergent.py public/index.html \
 && node -e "const f='package.json',p=require('./'+f);for(const k of ['dependencies','devDependencies'])if(p[k])delete p[k]['@emergentbase/visual-edits'];require('fs').writeFileSync(f,JSON.stringify(p,null,2))" \
 && python3 -c "import re;p='yarn.lock';s=open(p).read();s=re.sub(r'\n\"@emergentbase/visual-edits@[^\n]*\n(  [^\n]*\n)+','\n',s);open(p,'w').write(s)" \
 && yarn install --network-timeout 600000 --ignore-engines
RUN REACT_APP_BACKEND_URL=${PLACEHOLDER} REACT_APP_EXPO_URL=${PLACEHOLDER}/m/ \
    CI=false GENERATE_SOURCEMAP=false yarn build

# ── Phone app (web build, used by the in-portal phone viewer) ──────────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS phone
ARG PLACEHOLDER
WORKDIR /src/mobile
COPY mobile/ ./
RUN node -e "const f='app.json',a=require('./'+f);a.expo.experiments={...(a.expo.experiments||{}),baseUrl:'/m'};require('fs').writeFileSync(f,JSON.stringify(a,null,2))" \
 && yarn install --network-timeout 600000 --ignore-scripts --ignore-engines
RUN EXPO_PUBLIC_BACKEND_URL=${PLACEHOLDER} CI=1 EXPO_NO_TELEMETRY=1 \
    npx expo export --platform web --output-dir /out/m

# ── Serve ──────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/40-public-url.sh /docker-entrypoint.d/40-public-url.sh
COPY --from=portal /src/frontend/build /usr/share/nginx/html
COPY --from=phone /out/m /usr/share/nginx/html/m
RUN chmod +x /docker-entrypoint.d/40-public-url.sh
EXPOSE 80
