// node:os for the browser build: the worker's virtual file system has /tmp and /home.
export const tmpdir = () => '/tmp';
export const homedir = () => '/home';
export const platform = () => 'browser';
export const type = () => 'Browser';
export const arch = () => 'wasm';
export const release = () => '';
export const hostname = () => 'localhost';
export const cpus = () => [] as unknown[];
export const totalmem = () => 0;
export const freemem = () => 0;
export const userInfo = () => ({ username: 'user', homedir: '/home', shell: null, uid: 0, gid: 0 });
export const EOL = '\n';
export default { tmpdir, homedir, platform, type, arch, release, hostname, cpus, totalmem, freemem, userInfo, EOL };
