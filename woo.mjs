#!/usr/bin/env zx

import 'zx/globals';
import prompts from 'prompts';
import { chalk, quiet } from 'zx';
import { createLogger } from './util/createLogger.mjs';

const logger = createLogger('wooCli');

const parsePathsFromBranch = (branch) => {
	const directory = `woocommerce_${branch.replace('/', '-')}`;
	return {
		directory,
		clonePath: `${process.cwd()}/${directory}`,
	};
};

const operations = [
	{
		name: 'clone',
		run: async ({ branch, directory }) =>
			await $`git clone -b ${branch} git@github.com:woocommerce/woocommerce.git ${directory}`,
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
		run: async ({ branch, directory, clonePath }) => {
			await $`git clone -b ${
				argv['base'] || 'trunk'
			} git@github.com:woocommerce/woocommerce.git ${directory}`,
				cd(clonePath);
			await $`git checkout -b ${branch}`;
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
			target = argv['target'] || 'woocommerce',
		}) => {
			cd(clonePath);

			await $`pnpm --filter=${target} run build`;
		},
		args: ['b'],
	},
	{
		name: 'link',
		run: async ({ branch, site, clonePath = process.cwd() }) => {
			const wooPath = `${clonePath}/plugins/woocommerce/woocommerce.php`;

			await quiet(
				$`ln -fs "${clonePath}/plugins/woocommerce" "${os.homedir()}/Local Sites/${site}/app/public/wp-content/plugins/woocommerce"`
			);

			if (!branch) {
				branch = String(
					await quiet($`git branch --show-current`)
				).trim();
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
		prep: async () =>
			argv['branch']
				? { site: argv['branch'].replace(/[^a-z0-9]/gi, '') }
				: await prompts({
						type: 'text',
						name: 'site',
						message: 'Name of Local site to link?',
				  }),
		after: ({ site }) =>
			logger.info(
				`${chalk.green(
					'Successfully linked to Local site'
				)} ${chalk.bold(site)}`
			),
	},
	{
		name: 'watch',
		run: async ({
			clonePath = process.cwd(),
			target = argv['target'] || 'woocommerce/client/admin',
		}) => {
			cd(clonePath);

			await $`pnpm --filter=${target} run start`;
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

			const branch = String(
				await quiet($`git branch --show-current`)
			).trim();

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
		run: async () =>
			await $`pnpm --filter=woocommerce/client/admin run test:client`,
	},
	{
		name: 'test:js:watch',
		run: async ({ path = argv['path'] || '' }) =>
			await $`pnpm --filter=woocommerce/client/admin run test -- --watch ${path}`,
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

			await $`pnpm --filter=woocommerce run test:unit`;
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

for (const op of orderedToRun) {
	try {
		console.time(op.name);
		await op.run(config);
		op.after(config);
		console.timeEnd(op.name);
	} catch (e) {
		logger.warn(chalk.red(`Unable to run operation ${op.name}`, e.message));
		break;
	}
}
