export default function Clock({ className }: { className?: string }) {
    return (
        <svg className={'min-h-full min-w-full ' + className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#000000" fill="none">
            <path className="opacity-30 dark:opacity-20" d="M1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12Z" fill="currentColor"></path>
            <path className="dark:opacity-40 opacity-60" fillRule="evenodd" clipRule="evenodd" d="M12 7C12.5523 7 13 7.44772 13 8V11.5858L14.7071 13.2929C15.0976 13.6834 15.0976 14.3166 14.7071 14.7071C14.3166 15.0976 13.6834 15.0976 13.2929 14.7071L11.2929 12.7071C11.1054 12.5196 11 12.2652 11 12V8C11 7.44772 11.4477 7 12 7Z" fill="currentColor"></path>
        </svg>
    );
}
