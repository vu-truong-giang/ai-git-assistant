import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class GitCommandExecutor { 
    async execute(
        args: string[],
        cwd: string
    ): Promise<string> {
        const command = `git ${args.join('')}`;

        const {stdout , stderr} = await execAsync( command , { cwd });
        if (stderr) {
            console.warn(`Git warining: ${stderr}`);
        } 
        return stdout;
    }
}