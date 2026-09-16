FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY filfil-site/ /usr/share/nginx/html/
RUN test -s /usr/share/nginx/html/index.html
EXPOSE 80
