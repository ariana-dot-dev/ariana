export default function Stop({ className }: { className?: string }) {
    return (
        <svg className={'min-h-full min-w-full ' + className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#000000" fill="none">
            <path className="opacity-30 dark:opacity-20" d="M1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12Z" fill="currentColor"></path>
            <path className="dark:opacity-40 opacity-60" d="M9.01584 15.6148C9.59235 16 10.3949 16 12 16C13.6051 16 14.4076 16 14.9842 15.6148C15.2337 15.448 15.448 15.2337 15.6148 14.9842C16 14.4076 16 13.6051 16 12C16 10.3949 16 9.59235 15.6148 9.01584C15.448 8.76626 15.2337 8.55197 14.9842 8.38521C14.4076 8 13.6051 8 12 8C10.3949 8 9.59235 8 9.01584 8.38521C8.76626 8.55197 8.55198 8.76626 8.38521 9.01584C8 9.59235 8 10.3949 8 12C8 13.6051 8 14.4076 8.38521 14.9842C8.55198 15.2337 8.76626 15.448 9.01584 15.6148Z" fill="currentColor"></path>
        </svg>
    );
}
