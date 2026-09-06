# Official Puppeteer image: ships a matching Chrome for Testing build plus
# every system library headless Chrome needs, so we don't hand-maintain an
# apt package list. Keep this tag in step with the "puppeteer" version in
# package.json.
FROM ghcr.io/puppeteer/puppeteer:25.10.0

# pptruser's home is already writable by pptruser (the image's default,
# non-root user); using it as the workdir avoids extra chown steps.
WORKDIR /home/pptruser/app

COPY --chown=pptruser:pptruser package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --chown=pptruser:pptruser index.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
