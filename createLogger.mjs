export const createLogger = (str, mute = false) => ({
	log: (...args) =>
		mute
			? () => {}
			: console.log(chalk.cyan.bold(str), chalk.white('|'), ...args),
	warn: (...args) =>
		mute
			? () => {}
			: console.warn(chalk.yellow.bold(str), chalk.white('|'), ...args),
	debug: (...args) =>
		mute
			? () => {}
			: console.debug(chalk.gray.bold(str), chalk.white('|'), ...args),
	info: (...args) =>
		mute
			? () => {}
			: console.info(chalk.cyan.bold(str), chalk.white('|'), ...args),
	error: (...args) =>
		mute
			? () => {}
			: console.error(chalk.red.bold(str), chalk.white('|'), ...args),
});
