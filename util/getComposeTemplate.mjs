export const getComposeTemplate = (pluginPath) => `
services:
  web:
    volumes:
      - "${pluginPath}:/var/www/html/wp-content/plugins/${pluginPath
	.split('/')
	.pop()}"
`;
