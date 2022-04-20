#!/usr/bin/env zx

const prompts = require('prompts');

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

			const directory = branch.replace('/', '-');

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
			await `pnpm nx composer-install woocommerce`;
		},
		args: ['i'],
	},
	{
		name: 'build',
		run: async ({ clonePath = process.cwd() }) => {
			cd(clonePath);
			await $`pnpm nx composer-install woocommerce && pnpm nx build woocommerce`;
		},
		args: ['b'],
	},
	{
		name: 'watch',
		run: async ({ clonePath = process.cwd() }) => {
			cd(clonePath);
			await $`pnpm nx build-watch woocommerce-admin`;
		},
		args: ['w'],
	},
	{
		name: 'link',
		run: async ({ site, clonePath = process.cwd() }) =>
			await $`ln -fs "${clonePath}/plugins/woocommerce" "~/Local Sites/${site}/app/public/wp-content/plugins/woocommerce"`,
		args: ['l'],
		prep: async () =>
			await prompts({
				type: 'text',
				name: 'site',
				message: 'Name of Local site to link?',
			}),
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
		console.warn(`Unable to run operation ${op.name}`, e.message);
		break;
	}
}
