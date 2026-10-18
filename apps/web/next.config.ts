import type {NextConfig} from 'next';
import {resolve} from 'node:path';
const config:NextConfig={serverExternalPackages:['better-sqlite3'],outputFileTracingRoot:resolve(__dirname,'../..')};
export default config;
