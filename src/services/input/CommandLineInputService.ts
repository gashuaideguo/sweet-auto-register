import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export class CommandLineInputService {
    async readPhoneNumber(): Promise<string> {
        const phoneNumber = await this.readRequiredValue('请输入手机号：');
        return phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    }

    async readSmsCode(): Promise<string> {
        return await this.readRequiredValue('请输入短信验证码：');
    }

    private async readRequiredValue(prompt: string): Promise<string> {
        const readline = createInterface({ input, output });
        try {
            const value = (await readline.question(prompt)).trim();
            if (!value) {
                throw new Error('命令行输入不能为空。');
            }
            return value;
        } finally {
            readline.close();
        }
    }
}
