#!/usr/bin/env zx

import 'zx/globals';
import prompts from 'prompts';
import { chalk, quiet } from 'zx';
import { createLogger } from './util/createLogger.mjs';
import YAML from 'yaml';
import path from 'path';

const logger = createLogger('wooCli');

process.env.FORCE_COLOR = '1';

const PATH_FOR_WP = `${os.homedir()}/sites/wp`;
const PATH_FOR_BLUEPRINTS = `${os.homedir()}/sites/blueprints`;
const DEFAULT_BLUEPRINT = `blueprint-WP-65`;

const getExternalReposPath = (siteName) =>
	`${PATH_FOR_WP}/${siteName}/external_repos`;
const getWooCommercePath = (siteName) =>
	`${getExternalReposPath(siteName)}/woocommerce`;
const getPluginsPath = (siteName) =>
	`${PATH_FOR_WP}/${siteName}/wp-content/plugins`;

const getWooPluginPath = (siteName) =>
	`${getWooCommercePath(siteName)}/plugins/woocommerce`;

const simplifyToPath = (branch) => {
	return branch
		.replace('/', '-')
		.replace('_', '-')
		.replace(/[^a-z0-9-]/gi, '');
};

const getCurrentBranch = async () => {
	return String(await quiet($`git branch --show-current`)).trim();
};

const siteNameFromWP = () => {
	if (!process.cwd().includes(PATH_FOR_WP)) {
		return null;
	}
	const cwdParts = process.cwd().split('/');
	const parentDir = PATH_FOR_WP.split('/').pop();
	const siteNameIndex = cwdParts.indexOf(parentDir) + 1;
	return cwdParts[siteNameIndex];
};

// Helper to get siteName from branch, current directory, or arguments
const getSiteName = async () => {
	return argv['branch']
		? simplifyToPath(argv['branch'])
		: argv['site-name']
		? simplifyToPath(argv['site-name'])
		: siteNameFromWP()
		? siteNameFromWP()
		: (
				await prompts({
					type: 'text',
					name: 'site',
					initial: 'trunk',
					message: 'What is the directory name of your site?',
				})
		  ).site;
};

const operations = [
	{
		name: 'site',
		run: async ({ blueprint, siteName, sitePath }) => {
			await $`cp -r ${PATH_FOR_BLUEPRINTS}/${blueprint} ${sitePath}`;

			cd(sitePath);

			// Create external_repos directory
			await $`mkdir -p ${getExternalReposPath(siteName)}`;

			await $`ddev import-db --file=db_export.sql.gz`;
			await $`ddev stop --unlist ${blueprint}`;
			await $`ddev config --project-name=${siteName}`;
		},
		prep: async () => {
			const blueprint = argv['blueprint']
				? argv['blueprint']
				: DEFAULT_BLUEPRINT;

			const siteName = await getSiteName();

			return {
				blueprint,
				siteName,
				sitePath: `${PATH_FOR_WP}/${siteName}`,
			};
		},
		afterAll: async ({ sitePath }) => {
			cd(sitePath);
			await $`ddev launch wp-admin`;
		},
		args: ['s'],
	},
	{
		name: 'clone',
		run: async ({ branch, siteName }) => {
			const clonePath = getWooCommercePath(siteName);
			await $`git clone -b ${branch} git@github.com:woocommerce/woocommerce.git ${clonePath}`;
		},
		prep: async () => {
			const branch = argv['branch']
				? argv['branch']
				: (
						await prompts({
							type: 'text',
							name: 'branch',
							initial: 'trunk',
							message: 'What branch would you like to checkout?',
						})
				  ).branch;

			const siteName = await getSiteName();

			return {
				branch,
				siteName,
			};
		},
	},
	{
		name: 'create',
		run: async ({ branch, siteName }) => {
			const clonePath = getWooCommercePath(siteName);
			await $`git clone -b ${
				argv['base'] || 'trunk'
			} git@github.com:woocommerce/woocommerce.git ${clonePath}`;

			cd(clonePath);
			await $`git checkout -b ${branch}`;
			await $`git push -u origin ${branch} --no-verify`;
		},
		prep: async () => {
			const branch = argv['branch']
				? argv['branch']
				: (
						await prompts({
							type: 'text',
							name: 'branch',
							message:
								'What would you like to call your new branch?',
						})
				  ).branch;

			const siteName = await getSiteName();

			return {
				branch,
				siteName,
			};
		},
	},
	{
		name: 'clean',
		run: async ({ siteName }) => {
			cd(getWooCommercePath(siteName));
			await $`pnpm run clean`;
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'install',
		run: async ({ siteName }) => {
			cd(getWooCommercePath(siteName));
			await $`pnpm install`;
		},
		args: ['i'],
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'build',
		run: async ({
			siteName,
			target = argv['target'] || '@woocommerce/plugin-woocommerce',
		}) => {
			cd(getWooCommercePath(siteName));
			await $`pnpm --filter=${target} run build`;
		},
		args: ['b'],
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'link-plugin',
		run: async ({ siteName, clonePath = process.cwd() }) => {
			const composeFilePath = `${PATH_FOR_WP}/${siteName}/.ddev/docker-compose.mounts.yaml`;
			let composeContent = '';

			try {
				composeContent = await fs.readFile(composeFilePath, 'utf8');
			} catch (err) {
				if (err.code !== 'ENOENT') throw err; // Ignore if file does not exist
			}

			let composeData = composeContent ? YAML.parse(composeContent) : {};
			const newVolume = `${clonePath}:/var/www/html/wp-content/plugins/${clonePath
				.split('/')
				.pop()}`;

			if (!composeData.services) {
				composeData.services = {};
			}
			if (!composeData.services.web) {
				composeData.services.web = {};
			}
			if (!composeData.services.web.volumes) {
				composeData.services.web.volumes = [];
			}

			if (!composeData.services.web.volumes.includes(newVolume)) {
				composeData.services.web.volumes.push(newVolume);
			} else {
				logger.info(`Already exists -> ${newVolume}`);
			}

			const newComposeContent = YAML.stringify(composeData);
			await fs.outputFile(composeFilePath, newComposeContent);

			cd(`${PATH_FOR_WP}/${siteName}`);

			await $`ddev restart`;
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
		after: ({ siteName }) =>
			logger.info(
				`${chalk.green(
					'Successfully linked plugin to site'
				)} ${chalk.bold(siteName)}`
			),
	},
	{
		name: 'link-docker',
		run: async ({ siteName }) => {
			const linkOp = operations.get('link-plugin');

			await linkOp.run({
				siteName,
				clonePath: getWooPluginPath(siteName),
			});
		},
		args: ['ld'],
		prep: async () => ({
			siteName: await getSiteName(),
		}),
		after: ({ siteName }) =>
			logger.info(
				`${chalk.green('Successfully linked to site')} ${chalk.bold(
					siteName
				)}`
			),
	},
	{
		name: 'link',
		run: async ({ siteName }) => {
			// Store the original plugin directory path
			const pluginPath = process.cwd();
			const pluginName = pluginPath.split('/').pop();
			const pluginsPath = getPluginsPath(siteName);
			const targetPath = `${pluginsPath}/${pluginName}`;

			// Ensure the plugins directory exists
			await $`mkdir -p ${pluginsPath}`;

			// Remove existing symlink if it exists
			await quiet(nothrow($`rm -f ${targetPath}`));

			// Create relative symlink from the plugins directory to original plugin directory
			cd(pluginsPath);
			const relativePath = path.relative(pluginsPath, pluginPath);
			await $`ln -s ${relativePath} ${pluginName}`;

			logger.info(`Linked ${pluginName} to ${targetPath}`);
		},
		args: ['l'],
		prep: async () => ({
			siteName: await getSiteName(),
		}),
		after: ({ siteName }) => {
			const pluginName = process.cwd().split('/').pop();
			logger.info(
				`${chalk.green('Successfully linked')} ${chalk.bold(
					pluginName
				)} ${chalk.green('to site')} ${chalk.bold(siteName)}`
			);
		},
	},
	{
		name: 'watch',
		run: async ({
			siteName,
			target = argv['target'] || '@woocommerce/plugin-woocommerce',
		}) => {
			cd(getWooCommercePath(siteName));
			await $`pnpm --filter='${target}' watch:build`;
		},
		args: ['w'],
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'changelog',
		run: async ({ siteName }) => {
			cd(getWooPluginPath(siteName));
			await $`./vendor/bin/changelogger add`;
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'push',
		run: async ({ siteName }) => {
			cd(getWooCommercePath(siteName));

			const conditionalPop = async () => {
				if (argv['pop']) {
					await quiet($`git stash pop`);
				}
			};

			const branch = await getCurrentBranch();

			if (argv['pop']) {
				await quiet($`git stash`);
			}

			try {
				await $`git push origin ${branch}`;
			} catch (e) {
				await conditionalPop();
				throw new Error(e);
			}

			await conditionalPop();
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'test:js',
		run: async ({ siteName, path = argv['path'] || '' }) => {
			cd(getWooCommercePath(siteName));
			await $`pnpm --filter=woocommerce/client/admin run test:client ${path}`;
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'test:js:watch',
		run: async ({ siteName, path = argv['path'] || '' }) => {
			cd(getWooCommercePath(siteName));
			await $`pnpm --filter=woocommerce/client/admin test:client ${path} --watch`;
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
	{
		name: 'test:php:prepare',
		run: async ({ siteName }) => {
			cd(getWooCommercePath(siteName));
			await quiet(nothrow($`rm -rf /tmp/wordpress-tests-lib`));

			await $`docker run --rm --name woocommerce_test_db -p 3307:3306 -e MYSQL_ROOT_PASSWORD=woocommerce_test_password -d mysql:5.7.33`;
			await quiet($`sleep 5`);
			await $`./plugins/woocommerce/tests/bin/install.sh woocommerce_tests root woocommerce_test_password 0.0.0.0:3307`;
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
		_isReady: async () => {
			return quiet($`docker ps`).then((result) =>
				Boolean(~result.stdout.indexOf('woocommerce_test_db'))
			);
		},
	},
	{
		name: 'test:php',
		run: async (...args) => {
			const prepareOp = operations.get('test:php:prepare');

			const isReady = await prepareOp._isReady();

			if (!isReady) {
				await prepareOp.run(...args);
			}

			await $`pnpm --filter=@woocommerce/plugin-woocommerce run test:unit`;
		},
	},
	{
		name: 'test:php:failing',
		run: async () => {
			const prepareOp = operations.get('test:php:prepare');

			const isReady = await prepareOp._isReady();

			if (!isReady) {
				await prepareOp.run(...args);
			}

			await $`pnpm --filter=woocommerce run test:unit -- --group failing`;
		},
	},
	{
		name: 'storybook',
		run: async () => {
			await $`pnpm --filter=@woocommerce/storybook build-storybook`;
			await $`pnpm --filter=@woocommerce/storybook storybook`;
		},
	},
	{
		name: 'pnpm-reset',
		run: async () => {
			//await $`git clean -fdx`;
			await $`pnpm store prune`;
			await $`rm -fr "$(pnpm store path)"`;
		},
	},
	{
		name: 'tail-errors',
		run: async ({ siteName }) => {
			cd(`${PATH_FOR_WP}/${siteName}`);
			await $`ddev exec tail -n0 -f /var/www/html/wp-content/debug.log`;
		},
		prep: async () => ({
			siteName: await getSiteName(),
		}),
	},
].map((item, index) => ({
	...item,
	order: index,
	after: item.after
		? item.after
		: () =>
				logger.info(
					`${chalk.green(
						'Successfully completed operation'
					)} ${chalk.bold(item.name)}`
				),
}));

operations.get = (name) => operations.find((item) => item.name === name);

const toRun = [];

if (argv._[1]) {
	const initial = operations.find((op) => op.name === argv._[1]);
	if (!initial) {
		logger.warn(`"${argv._[1]}" is an invalid operation`);
		process.exit(1);
	}
	toRun.push(operations.find((op) => op.name === argv._[1]));
}

toRun.push(
	...operations.filter((op) => op.args && op.args.some((arg) => argv[arg]))
);

if (!toRun.length) {
	logger.warn('Nothing to do');
	process.exit(0);
}

let config = {};

// Remove any duplicates and order
const orderedToRun = [
	...new Map(toRun.map((item) => [item['name'], item])).values(),
].sort((a, b) => a.order - b.order);

for (const op of orderedToRun) {
	if (op.prep) {
		config = { ...config, ...(await Promise.resolve(op.prep())) };
	}
}

const afterAllHandlers = [];

for (const op of orderedToRun) {
	try {
		console.time(op.name);
		await op.run(config);
		op.after(config);
		console.timeEnd(op.name);
		if (op.afterAll) {
			afterAllHandlers.push(op.afterAll);
		}
	} catch (e) {
		logger.warn(chalk.red(`Unable to run operation ${op.name}`, e.message));
		break;
	}
}

for (const handler of afterAllHandlers) {
	await handler(config);
}
