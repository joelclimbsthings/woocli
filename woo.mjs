#!/usr/bin/env zx

import 'zx/globals';
import prompts from 'prompts';
import { chalk, quiet } from 'zx';
import { createLogger } from './util/createLogger.mjs';
import YAML from 'yaml';

const logger = createLogger('wooCli');

process.env.FORCE_COLOR = '1';

const PATH_FOR_WP = `${os.homedir()}/sites/wp`;
const PATH_FOR_WOOMONO = `${os.homedir()}/sites/woomono`;
const PATH_FOR_BLUEPRINTS = `${os.homedir()}/sites/blueprints`;
const DEFAULT_BLUEPRINT = `blueprint-WP-65`;

const simplifyToPath = (branch) => {
	return branch
		.replace('/', '-')
		.replace('_', '-')
		.replace(/[^a-z0-9-]/gi, '');
};

const parsePathsFromBranch = (branch) => ({
	clonePath: `${PATH_FOR_WOOMONO}/${simplifyToPath(branch)}`,
});

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

const operations = [
	{
		name: 'site',
		run: async ({ blueprint, siteName, sitePath }) => {
			await $`cp -r ${PATH_FOR_BLUEPRINTS}/${blueprint} ${sitePath}`;

			cd(sitePath);

			await $`ddev config --project-name=${siteName}`;
			await $`ddev import-db --file=db_export.sql.gz`;
		},
		prep: async () => {
			const blueprint = argv['blueprint']
				? argv['blueprint']
				: DEFAULT_BLUEPRINT;

			const siteName = argv['site-name']
				? simplifyToPath(argv['site-name'])
				: argv['branch']
				? simplifyToPath(argv['branch'])
				: (
						await prompts({
							type: 'text',
							name: 'site',
							initial: 'trunk',
							message: 'What would you like to call your site?',
						})
				  ).site;

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
		run: async ({ branch, clonePath }) =>
			await $`git clone -b ${branch} git@github.com:woocommerce/woocommerce.git ${clonePath}`,
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

			return {
				branch,
				...parsePathsFromBranch(branch),
			};
		},
	},
	{
		name: 'create',
		run: async ({ branch, clonePath }) => {
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

			return {
				branch,
				...parsePathsFromBranch(branch),
			};
		},
	},
	{
		name: 'clean',
		run: async ({ clonePath = process.cwd() }) => {
			cd(clonePath);

			await $`pnpm run clean`;
		},
	},
	{
		name: 'install',
		run: async ({ clonePath = process.cwd() }) => {
			cd(clonePath);
			await $`pnpm install`;
		},
		args: ['i'],
	},
	{
		name: 'build',
		run: async ({
			clonePath = process.cwd(),
			target = argv['target'] || '@woocommerce/plugin-woocommerce',
		}) => {
			cd(clonePath);

			await $`pnpm --filter=${target} run build`;
		},
		args: ['b'],
	},
	{
		name: 'linkbasic',
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
		prep: async () => operations.get('link').prep(),
		after: ({ siteName }) => operations.get('link').after({ siteName }),
	},
	{
		name: 'link',
		run: async ({ branch, siteName, clonePath = process.cwd() }) => {
			const wooPath = `${clonePath}/plugins/woocommerce/woocommerce.php`;

			const linkOp = operations.get('linkbasic');

			linkOp.run({
				siteName,
				clonePath: `${clonePath}/plugins/woocommerce`,
			});

			if (!branch) {
				branch = await getCurrentBranch();
			}

			const branchTitle = branch.replace('/', '-');

			if (
				(await quiet(nothrow($`grep -Fq "${branchTitle}" ${wooPath}`))
					.exitCode) === 0
			) {
				return;
			}

			await quiet(
				$`sed -i 's/Plugin Name: WooCommerce/Plugin Name: WooCommerce (${branchTitle})/g' ${clonePath}/plugins/woocommerce/woocommerce.php`
			);
		},
		args: ['l'],
		prep: async () => {
			const siteName = argv['branch']
				? simplifyToPath(argv['branch'])
				: argv['site-name']
				? simplifyToPath(argv['site-name'])
				: (
						await prompts({
							type: 'text',
							name: 'site',
							initial: 'trunk',
							message: 'What would you like to call your site?',
						})
				  ).site;

			return {
				siteName,
			};
		},
		after: ({ siteName }) =>
			logger.info(
				`${chalk.green('Successfully linked to site')} ${chalk.bold(
					siteName
				)}`
			),
	},
	{
		name: 'watch',
		run: async ({
			clonePath = process.cwd(),
			target = argv['target'] || '@woocommerce/plugin-woocommerce',
		}) => {
			cd(clonePath);

			await $`pnpm --filter='${target}' watch:build`;
		},
		args: ['w'],
	},
	{
		name: 'changelog',
		run: async ({ clonePath = process.cwd() }) => {
			cd(`${clonePath}/plugins/woocommerce`);
			await $`./vendor/bin/changelogger add`;
		},
	},
	{
		name: 'push',
		run: async () => {
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
	},
	{
		name: 'test:js',
		run: async ({ path = argv['path'] || '' }) =>
			await $`pnpm --filter=woocommerce/client/admin run test:client ${path}`,
	},
	{
		name: 'test:js:watch',
		run: async ({ path = argv['path'] || '' }) =>
			await $`pnpm --filter=woocommerce/client/admin test:client ${path} --watch`,
	},
	{
		name: 'test:php:prepare',
		run: async ({ clonePath = process.cwd() }) => {
			cd(clonePath);
			await quiet(nothrow($`rm -rf /tmp/wordpress-tests-lib`));

			await $`docker run --rm --name woocommerce_test_db -p 3307:3306 -e MYSQL_ROOT_PASSWORD=woocommerce_test_password -d mysql:5.7.33`;
			await quiet($`sleep 5`);
			await $`./plugins/woocommerce/tests/bin/install.sh woocommerce_tests root woocommerce_test_password 0.0.0.0:3307`;
		},
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
		run: async ({ branch }) => {
			const siteName = process.cwd().includes(PATH_FOR_WP)
				? siteNameFromWP()
				: simplifyToPath(branch || (await getCurrentBranch()));

			cd(`${PATH_FOR_WP}/${siteName}`);

			await $`ddev exec tail -n0 -f /var/www/html/wp-content/debug.log`;
		},
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
