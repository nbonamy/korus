"""Compare paired full Vue runs, requiring test equality and coverage supersets."""
import argparse,collections,json,os,pathlib

def read(path):return json.loads(path.read_text())
def encoded(value):return json.dumps(value,sort_keys=True)
def locations(item,field):
    values=item[field].values()
    if field=='fnMap':values=({k:v for k,v in value.items()if k not in ['name','line']}for value in values)
    return collections.Counter(map(encoded,values))

def compare(root,expected,titles):
    bad=[k for k,v in json.loads(os.environ.get('CI_BENCH_NEEDS','{}')).items()if v.get('result')!='success']
    if bad:raise ValueError('Unsuccessful prerequisites: '+', '.join(bad))
    renames={(r['file'],r['after']):r['before']for r in read(titles)}
    rows=[];reference=None
    for pair in expected:
        evidence={}
        for variant in ['v4','v5-fixed']:
            folder=root/pair/variant;source=read(folder/'source.json');metric=read(folder/f'metric-vue-{variant}.json');tests=read(folder/'tests.json');coverage=read(folder/'coverage/coverage-final.json')
            if metric['exit_code']!=0 or not tests['success']or tests['numFailedTests']:raise ValueError('Failed command or tests: '+pair+' '+variant)
            if source['workers']not in [2,4] or source['pool']!='vmThreads'or not source['isolate']or source['clearMocks']:raise ValueError('Changed test execution contract')
            relative=lambda file:str(pathlib.Path(file).relative_to(source['root']))
            inventory=collections.Counter()
            for file in tests['testResults']:
                name=relative(file['name'])
                for case in file['assertionResults']:
                    if case['status']!='passed':raise ValueError('Skipped or failed test')
                    title=renames.get((name.removeprefix('vue/'),case['fullName']),case['fullName'])if variant=='v5-fixed'else case['fullName']
                    location=case.get('location')
                    if not location:raise ValueError('Missing test location')
                    inventory[(name,title,location['line'],location['column'])]+=1
            if not inventory:raise ValueError('Empty tests')
            coverage={relative(file):item for file,item in coverage.items()}
            if not coverage:raise ValueError('Empty coverage')
            counts=[n for item in coverage.values()for n in item['s'].values()]
            if not counts or sum(n>0 for n in counts)/len(counts)<.85:raise ValueError('Statement coverage below 85%')
            evidence[variant]=(source,metric,inventory,coverage)
        old,new=evidence['v4'],evidence['v5-fixed']
        for key in ['sha','source_tree','workers','node','cpu_model']:
            if old[0][key]!=new[0][key]:raise ValueError('Source or runner differs: '+key)
        if old[2]!=new[2]:raise ValueError('Test inventory differs')
        current=(old[0]['sha'],old[0]['source_tree'],old[0]['workers'],old[2])
        if reference is None:reference=current
        elif current!=reference:raise ValueError('Source/tests differ between pairs')
        if old[3].keys()!=new[3].keys():raise ValueError('Covered file set differs')
        added={}
        for field in ['statementMap','fnMap','branchMap']:
            total=0
            for file in old[3]:
                before,after=locations(old[3][file],field),locations(new[3][file],field)
                if before-after:raise ValueError('Baseline coverage locations removed: '+file+' '+field)
                total+=sum((after-before).values())
            added[field]=total
        runs={}
        for variant,(source,metric,inventory,coverage)in evidence.items():
            counts=[n for item in coverage.values()for n in item['s'].values()]
            runs[variant]={'elapsed_seconds':metric['elapsed_seconds'],'peak_tree_rss_bytes':metric['peak_tree_rss_bytes'],'statements':{'covered':sum(n>0 for n in counts),'total':len(counts),'percent':100*sum(n>0 for n in counts)/len(counts)}}
        rows.append({'pair':pair,'workers':old[0]['workers'],'sha':old[0]['sha'],'cpu_model':old[0]['cpu_model'],'test_cases':sum(old[2].values()),'coverage_files':len(old[3]),'added_locations':added,'runs':runs,'improvement_percent':100*(1-runs['v5-fixed']['elapsed_seconds']/runs['v4']['elapsed_seconds'])})
    result={'result':'all tests match after reviewed title formatting; every baseline coverage location retained; every run passes 85% statements','pairs':rows}
    (root/'vue-v5-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--expect',action='append',required=True);p.add_argument('--title-map',type=pathlib.Path,default=pathlib.Path(__file__).with_name('ci-vue-v5-title-map.json'));a=p.parse_args();compare(a.input,a.expect,a.title_map)
