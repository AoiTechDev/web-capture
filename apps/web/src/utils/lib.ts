export function extractDomain(url: string){
    return url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/?#]+)/)?.[1];
}