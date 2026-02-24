export default function UserCircle({ className }: { className?: string }) {
    return (
        <svg className={'min-h-full min-w-full ' + className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#000000" fill="none">
            <path className="opacity-30 dark:opacity-20" d="M1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12Z" fill="currentColor"></path>
            <path className="dark:opacity-40 opacity-60" d="M12 5.25C10.2051 5.25 8.75 6.70507 8.75 8.5C8.75 9.78708 9.49818 10.8994 10.5833 11.4258C8.12834 12.0478 6.30285 14.249 6.25112 16.8853C6.24717 17.0867 6.32439 17.2812 6.4654 17.425C7.87109 18.8589 9.83216 19.75 12 19.75C14.1684 19.75 16.1299 18.8585 17.5357 17.4239C17.6767 17.28 17.7538 17.0855 17.7498 16.8841C17.6976 14.2482 15.8715 12.0477 13.4167 11.4258C14.5018 10.8994 15.25 9.78708 15.25 8.5C15.25 6.70507 13.7949 5.25 12 5.25Z" fill="currentColor"></path>
        </svg>
    );
}
