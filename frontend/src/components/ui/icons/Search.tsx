export default function Search({ className }: { className?: string }) {
    return (
        <svg className={'min-h-full min-w-full ' + className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#000000" fill="none">
            <path className="opacity-30 dark:opacity-20" fillRule="evenodd" clipRule="evenodd" d="M2 11.0003C2 6.0297 6.02944 2.00026 11 2.00026C15.9706 2.00026 20 6.0297 20 11.0003C20 15.9708 15.9706 20.0003 11 20.0003C6.02944 20.0003 2 15.9708 2 11.0003ZM11 4.00026C7.13401 4.00026 4 7.13427 4 11.0003C4 14.8663 7.13401 18.0003 11 18.0003C14.866 18.0003 18 14.8663 18 11.0003C18 7.13427 14.866 4.00026 11 4.00026Z" fill="currentColor"></path>
            <path className="dark:opacity-40 opacity-60" d="M18.0319 16.6174C17.6143 17.1395 17.1397 17.614 16.6177 18.0317L20.2929 21.7069C20.6834 22.0974 21.3166 22.0974 21.7071 21.7069C22.0976 21.3163 22.0976 20.6832 21.7071 20.2926L18.0319 16.6174Z" fill="currentColor"></path>
        </svg>
    );
}
