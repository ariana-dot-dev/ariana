export default function CloudConnection({ className }: { className?: string }) {
    return (
        <svg className={'min-h-full min-w-full ' + className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#000000" fill="none">
            <path className="opacity-30 dark:opacity-20" d="M1.25 12C1.25 9.21699 3.22664 6.89643 5.853 6.36454C6.38731 3.45456 8.93585 1.25 12 1.25C15.3858 1.25 18.1428 3.94224 18.2469 7.30273C20.7927 7.66534 22.75 9.85409 22.75 12.5C22.75 15.3995 20.3995 17.75 17.5 17.75H7C3.82436 17.75 1.25 15.1756 1.25 12Z" fill="currentColor" />
            <path className="dark:opacity-40 opacity-60" d="M11.25 17.75V18.75H11C10.2072 18.75 9.53761 19.2771 9.32247 20H5C4.58579 20 4.25 20.3358 4.25 20.75C4.25 21.1642 4.58579 21.5 5 21.5H9.32247C9.53761 22.2229 10.2072 22.75 11 22.75H13C13.7928 22.75 14.4624 22.2229 14.6775 21.5H19C19.4142 21.5 19.75 21.1642 19.75 20.75C19.75 20.3358 19.4142 20 19 20H14.6775C14.4624 19.2771 13.7928 18.75 13 18.75H12.75V17.75H11.25Z" fill="currentColor" />
        </svg>
    );
}
