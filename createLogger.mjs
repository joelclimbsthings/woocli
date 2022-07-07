export const createLogger = (str, mute = false) => ({
	log: (...args) =>
		mute ? () => {} : console.log(chalk.cyan.bold(str), ...args),
	warn: (...args) =>
		mute ? () => {} : console.warn(chalk.yellow.bold(str), ...args),
	debug: (...args) =>
		mute ? () => {} : console.debug(chalk.gray.bold(str), ...args),
	info: (...args) =>
		mute ? () => {} : console.info(chalk.cyan.bold(str), ...args),
	error: (...args) =>
		mute ? () => {} : console.error(chalk.red.bold(str), ...args),
});
