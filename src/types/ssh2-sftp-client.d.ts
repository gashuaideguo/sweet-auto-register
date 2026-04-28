declare module 'ssh2-sftp-client' {
  type ConnectOptions = {
    host: string;
    port?: number;
    username: string;
    password?: string;
  };

  export default class SftpClient {
    connect(options: ConnectOptions): Promise<unknown>;
    mkdir(path: string, recursive?: boolean): Promise<unknown>;
    put(src: string, remotePath: string): Promise<unknown>;
    end(): Promise<unknown>;
  }
}
