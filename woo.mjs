#!/usr/bin/env zx

import 'zx/globals';
import prompts from 'prompts';

const operations = [
	{
		name: 'clone',
		run: async ({ branch, directory }) =>
			await $`git clone -b ${branch} git@github.com:woocommerce/woocommerce.git ${directory}`,
		prep: async () => {
			const { branch } = await prompts({
				type: 'text',
				name: 'branch',
				initial: 'trunk',
				message: 'What branch would you like to checkout?',
			});

			const directory = `woocommerce_${branch.replace('/', '-')}`;

			return {
				branch,
				directory,
				clonePath: `${process.cwd()}/${directory}`,
			};
		},
	},
	{
		name: 'create',
		run: async ({ branch, directory, clonePath }) => {
			await $`git clone git@github.com:woocommerce/woocommerce.git ${directory}`;
			cd(clonePath);
			await $`git checkout -b ${branch}`;
		},
		prep: async () => {
			const { branch } = await prompts({
				type: 'text',
				name: 'branch',
				message: 'What would you like to call your new branch?',
			});

			const directory = `woocommerce_${branch.replace('/', '-')}`;

			return {
				branch,
				directory,
				clonePath: `${process.cwd()}/${directory}`,
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
			// Temporary fix
			// await $`sed -i 's/pnpx/pnpm exec/g' ./plugins/woocommerce/legacy/project.json`;

			await $`pnpm exec turbo run build --filter=${target}`;

			// Fix cleanup
			// await $`sed -i 's/pnpm exec/pnpx/g' ./plugins/woocommerce/legacy/project.json`;
		},
		args: ['b'],
	},
	{
		name: 'link',
		run: async ({ branch, site, clonePath = process.cwd() }) => {
			const wooPath = `${clonePath}/plugins/woocommerce/woocommerce.php`;

			await $`ln -fs "${clonePath}/plugins/woocommerce" "${os.homedir()}/Local Sites/${site}/app/public/wp-content/plugins/woocommerce"`;

			if (!branch) {
				branch = String(await $`git branch --show-current`).trim();
			}

			const branchTitle = branch.replace('/', '-');

			if (
				(await nothrow($`grep -Fq "${branchTitle}" ${wooPath}`)
					.exitCode) === 0
			) {
				return;
			}

			await $`sed -i 's/Plugin Name: WooCommerce/Plugin Name: WooCommerce (${branchTitle})/g' ${clonePath}/plugins/woocommerce/woocommerce.php`;
		},
		args: ['l'],
		prep: async () =>
			await prompts({
				type: 'text',
				name: 'site',
				message: 'Name of Local site to link?',
			}),
	},
	{
		name: 'watch',
		run: async ({
			clonePath = process.cwd(),
			target = argv['target'] || '@woocommerce/admin-library',
		}) => {
			cd(clonePath);

			await $`pnpm start --filter=${target}`;
		},
		args: ['w'],
	},
	{
		name: 'changelog',
		run: async () => await $`pnpm changelog --filter=woocommerce add`,
	},
	{
		name: 'push',
		run: async () => {
			const branch = String(
				await quiet($`git branch --show-current`)
			).trim();
			await $`git push origin ${branch}`;
		},
	},
	{
		name: 'test:watch',
		run: async () =>
			await $`pnpm test:watch --filter=@woocommerce/admin-library`,
	},
	{
		name: 'test:prepare',
		run: async ({ clonePath = process.cwd() }) => {
			cd(clonePath);
			await $`docker run --rm --name woocommerce_test_db -p 3307:3306 -e MYSQL_ROOT_PASSWORD=woocommerce_test_password -d mysql:5.7.33`;
			await $`./plugins/woocommerce/tests/bin/install.sh woocommerce_tests root woocommerce_test_password 0.0.0.0:3307`;
		},
	},
	{
		name: 'test:php',
		run: async () => await $`pnpm test:unit --filter=woocommerce`,
	},
	{
		name: 'test:failing',
		run: async () =>
			await $`pnpm test:unit --filter=woocommerce -- --group failing`,
	},
];

const toRun = [];

if (argv._[1]) {
	const initial = operations.find((op) => op.name === argv._[1]);
	if (!initial) {
		console.warn(`"${argv._[1]}" is an invalid operation`);
		process.exit(1);
	}
	toRun.push(operations.find((op) => op.name === argv._[1]));
}

toRun.push(
	...operations.filter((op) => op.args && op.args.some((arg) => argv[arg]))
);

if (!toRun.length) {
	console.warn('Nothing to do');
	process.exit(0);
}

let config = {};

for (const op of toRun) {
	if (op.prep) {
		config = { ...config, ...(await Promise.resolve(op.prep())) };
	}
}

for (const op of toRun) {
	try {
		await op.run(config);
	} catch (e) {
		console.warn(
			chalk.red(`Unable to run operation ${op.name}`, e.message)
		);
		break;
	}
}
