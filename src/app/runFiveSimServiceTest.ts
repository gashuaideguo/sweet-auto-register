import {loadConfig} from '../config/loadConfig.js';
import type {FiveSimCountryConfig, SmsConfig} from '../config/types.js';
import {FiveSimService} from '../services/sms/FiveSimService.js';
import type {SmsActivation} from '../services/sms/types.js';
import {logger} from '../shared/logger.js';

type Command = 'phone' | 'ready' | 'activation' | 'status' | 'cancel' | 'complete';

type ParsedArgs = {
    command: string;
    options: Record<string, string>;
    positional: string[];
};

function usage(): string {
    return [
        '用法：',
        '  npm run 5sim:test -- phone [--country TH]',
        '  npm run 5sim:test -- activation <activationId> <phoneNumber>',
        '  npm run 5sim:test -- ready <activationId> <phoneNumber>',
        '  npm run 5sim:test -- status <activationId>',
        '  npm run 5sim:test -- cancel <activationId>',
        '  npm run 5sim:test -- complete <activationId>',
        '',
        '也可以使用参数名：--activation-id <id> --phone <phoneNumber>',
    ].join('\n');
}

function parseArgs(values: string[]): ParsedArgs {
    const [command = '', ...rest] = values;
    const options: Record<string, string> = {};
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
        const value = rest[index];
        if (!value.startsWith('--')) {
            positional.push(value);
            continue;
        }

        const separatorIndex = value.indexOf('=');
        if (separatorIndex >= 0) {
            options[value.slice(2, separatorIndex)] = value.slice(separatorIndex + 1);
            continue;
        }

        const key = value.slice(2);
        const next = rest[index + 1];
        if (next && !next.startsWith('--')) {
            options[key] = next;
            index += 1;
        } else {
            options[key] = '';
        }
    }

    return {command, options, positional};
}

function isCommand(command: string): command is Command {
    return ['phone', 'ready', 'activation', 'status', 'cancel', 'complete'].includes(command);
}

function selectCountry(config: SmsConfig, countryKey: string | undefined): FiveSimCountryConfig {
    const countries = config.fiveSim.countries;
    if (!countries.length) {
        throw new Error('sms.fiveSim.countries 至少需要配置一个国家。');
    }

    if (!countryKey) {
        return countries[0];
    }

    const normalizedCountryKey = countryKey.toLowerCase();
    const country = countries.find((item) => [
        item.name,
        item.browserOptionKey,
        item.browserDialCode,
        item.providerCountry,
        item.providerOperator,
    ].some((value) => value.toLowerCase() === normalizedCountryKey));

    if (!country) {
        throw new Error(`未找到 5sim 国家配置：${countryKey}`);
    }

    return country;
}

function readActivationId(args: ParsedArgs): number {
    const activationId = Number(args.options['activation-id'] || args.positional[0]);
    if (!Number.isInteger(activationId) || activationId <= 0) {
        throw new Error(`activationId 必填。\n${usage()}`);
    }

    return activationId;
}

function readActivation(args: ParsedArgs): SmsActivation {
    const activationId = readActivationId(args);
    const phoneNumber = args.options.phone || args.positional[1];

    if (!phoneNumber) {
        throw new Error(`phoneNumber 必填。\n${usage()}`);
    }

    return {
        activationId,
        phoneNumber,
    };
}

function assertFiveSimConfig(config: SmsConfig, command: Command): void {
    if (!config.fiveSim.apiKey) {
        throw new Error('sms.fiveSim.apiKey 必填。');
    }
    if (command === 'phone' && !config.fiveSim.product) {
        throw new Error('sms.fiveSim.product 必填。');
    }
}

async function runCommand(service: FiveSimService, command: Command, args: ParsedArgs): Promise<void> {
    if (command === 'phone') {
        logger.warn('[5sim测试] phone 会向 5sim 购买一个号码，必要时请随后执行 cancel 或 complete。');
        const phoneNumber = await service.getPhoneNumber();
        logger.info(`[5sim测试] phoneNumber=${phoneNumber}`);
        logger.info(`[5sim测试] activation=${JSON.stringify(service.getActivation())}`);
        return;
    }

    if (command === 'activation' || command === 'ready') {
        service.restoreActivation(readActivation(args));

        if (command === 'activation') {
            logger.info(`[5sim测试] activation=${JSON.stringify(service.getActivation())}`);
            return;
        }

        await service.markReady();
        logger.info(`[5sim测试] activation=${JSON.stringify(service.getActivation())}`);
        return;
    }

    const activationId = readActivationId(args);
    service.restoreActivation({activationId, phoneNumber: '<unused>'});

    if (command === 'status') {
        const status = await service.getStatus();
        logger.info(`[5sim测试] status=${JSON.stringify(status)}`);
        return;
    }

    if (command === 'cancel') {
        await service.cancel();
        logger.info(`[5sim测试] activation=${JSON.stringify(service.getActivation())}`);
        return;
    }

    await service.complete();
    logger.info(`[5sim测试] activation=${JSON.stringify(service.getActivation())}`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!isCommand(args.command)) {
        throw new Error(usage());
    }

    const config = loadConfig();
    assertFiveSimConfig(config.sms, args.command);

    const country = selectCountry(config.sms, args.options.country);
    logger.info(`[5sim测试] 使用国家配置：name=${country.name} providerCountry=${country.providerCountry} providerOperator=${country.providerOperator}`);

    const service = new FiveSimService(config.sms, country);
    await runCommand(service, args.command, args);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    logger.error(`[5sim测试] ${message}`);
    process.exitCode = 1;
});
