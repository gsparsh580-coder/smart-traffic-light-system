FROM nodered/node-red:latest

# Copy package and install dashboard
USER root
WORKDIR /usr/src/node-red
RUN npm install node-red-dashboard

# Copy custom flow
USER node-red
WORKDIR /data
COPY flows.json /data/flows.json

EXPOSE 1880
CMD ["npm", "start", "--cache", "/data/.npm", "--", "--userDir", "/data"]
